#!/usr/bin/env tsx

import { createServer } from 'node:http';
import type {
  APIGatewayEventRequestContextV2,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Callback,
  Context,
} from 'aws-lambda';
import { handler } from '../apps/bank-api/src/main.ts';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';

const isTextLikeContentType = (contentType: string | undefined) => {
  if (!contentType) {
    return true;
  }

  const normalized = contentType.toLowerCase();

  return (
    normalized.includes('application/json') ||
    normalized.includes('application/x-www-form-urlencoded') ||
    normalized.startsWith('text/') ||
    normalized.includes('application/xml') ||
    normalized.includes('application/javascript')
  );
};

const toHeaderRecord = (
  headers: Record<string, string | string[] | undefined>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key.toLowerCase(),
        Array.isArray(value)
          ? key.toLowerCase() === 'cookie'
            ? value.join('; ')
            : value.join(', ')
          : value,
      ])
  );

const createEvent = async (
  req: Parameters<typeof createServer>[0],
  bodyBuffer: Buffer
): Promise<APIGatewayProxyEventV2> => {
  const protocol = `HTTP/${req.httpVersion}`;
  const method = req.method ?? 'GET';
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const rawPath = requestUrl.pathname;
  const rawQueryString = requestUrl.search.startsWith('?')
    ? requestUrl.search.slice(1)
    : '';
  const headers = toHeaderRecord(req.headers);
  const contentType = headers['content-type'];
  const isBase64Encoded = !isTextLikeContentType(contentType);
  const body = bodyBuffer.length
    ? isBase64Encoded
      ? bodyBuffer.toString('base64')
      : bodyBuffer.toString('utf8')
    : undefined;

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath,
    rawQueryString,
    cookies: headers.cookie
      ? headers.cookie.split(';').map(value => value.trim())
      : undefined,
    headers,
    queryStringParameters: rawQueryString
      ? Object.fromEntries(requestUrl.searchParams.entries())
      : undefined,
    requestContext: {
      accountId: 'local',
      apiId: 'local-http-bridge',
      domainName: req.headers.host ?? 'localhost',
      domainPrefix: 'local',
      http: {
        method,
        path: rawPath,
        protocol,
        sourceIp: req.socket.remoteAddress ?? '127.0.0.1',
        userAgent: headers['user-agent'] ?? 'local-http-bridge',
      },
      requestId: `local-${Date.now()}`,
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    } as APIGatewayEventRequestContextV2,
    body,
    isBase64Encoded,
  };
};

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];

  req.on('data', chunk => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  req.on('end', async () => {
    try {
      const bodyBuffer = Buffer.concat(chunks);
      const event = await createEvent(req, bodyBuffer);
      const result = (await handler(
        event,
        {} as Context,
        {} as Callback
      )) as APIGatewayProxyResultV2;

      const statusCode =
        'statusCode' in result && typeof result.statusCode === 'number'
          ? result.statusCode
          : 200;
      const headers =
        'headers' in result && result.headers ? result.headers : undefined;
      const cookies =
        'cookies' in result && Array.isArray(result.cookies)
          ? result.cookies
          : [];

      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          if (value !== undefined) {
            res.setHeader(key, value);
          }
        });
      }

      if (cookies.length > 0) {
        res.setHeader('set-cookie', cookies);
      }

      res.statusCode = statusCode;

      const responseBody =
        'body' in result && typeof result.body === 'string'
          ? result.body
          : undefined;
      const encoded =
        'isBase64Encoded' in result ? result.isBase64Encoded : false;

      if (!responseBody) {
        res.end();
        return;
      }

      if (encoded) {
        res.end(Buffer.from(responseBody, 'base64'));
        return;
      }

      res.end(responseBody);
    } catch (error) {
      console.error('bank-api-local-bridge-error', {
        message: error instanceof Error ? error.message : String(error),
      });
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          message: 'Local bank API bridge failed.',
        })
      );
    }
  });
});

server.listen(port, host, () => {
  console.log(
    `bank-api-local-bridge listening on http://${host}:${port} (browser URL http://localhost:${port})`
  );
});
