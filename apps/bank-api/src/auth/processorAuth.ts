import { UnauthorizedRequestError } from './errors';

export const requireProcessorAuth = (
  request: { headers: Headers },
  expectedToken: string
) => {
  const header =
    request.headers.get('authorization') ??
    request.headers.get('Authorization');
  if (!header) {
    throw new UnauthorizedRequestError('Missing processor authorization');
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedRequestError('Invalid processor authorization');
  }

  if (token !== expectedToken) {
    throw new UnauthorizedRequestError('Invalid processor token');
  }
};
