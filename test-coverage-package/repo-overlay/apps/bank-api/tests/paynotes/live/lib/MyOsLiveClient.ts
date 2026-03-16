/**
 * Thin client for real MyOS pull-and-post tests.
 *
 * Aligns to the HTTP surface already used by bank:
 * - GET /myos-events/:id
 * - GET /documents/:sessionId
 * - POST /documents/bootstrap
 * - POST /documents/:sessionId/:operation
 *
 * For event polling, use the MyOS list API the same way lcloud does:
 * - GET /myos-events?ref=<sessionId>&type=DOCUMENT_CREATED&itemsPerPage=100&from=<ISO>
 * - GET /myos-events?ref=<sessionId>&type=DOCUMENT_EPOCH_ADVANCED&itemsPerPage=100&from=<ISO>
 *
 * Important details verified against the repo:
 * - Authorization header must contain the raw API key, without the Bearer prefix.
 * - ref filtering is substring/contains based, so tests must additionally filter:
 *   - DOCUMENT_CREATED => ref === sessionId
 *   - DOCUMENT_EPOCH_ADVANCED => ref startsWith(sessionId + ':')
 */
export const MYOS_DOCUMENT_CREATED = 'DOCUMENT_CREATED' as const;
export const MYOS_DOCUMENT_EPOCH_ADVANCED = 'DOCUMENT_EPOCH_ADVANCED' as const;

export type MyOsDocumentLifecycleEventType =
  | typeof MYOS_DOCUMENT_CREATED
  | typeof MYOS_DOCUMENT_EPOCH_ADVANCED;

export type RealMyOsClientOptions = {
  baseUrl: string;
  apiKey: string;
};

type MyOsListedEventResponse = {
  items?: Array<{
    id?: string;
    type?: string;
    created?: string;
    uid?: string;
    ref?: string;
  }>;
  nextPageToken?: string;
};

export type MyOsRelevantEvent = {
  id: string;
  type: MyOsDocumentLifecycleEventType;
  createdAt: string;
  ref: string;
  sessionId: string;
  epoch?: number;
};

const parseEpochFromRef = (ref: string): number | undefined => {
  const epochToken = ref.split(':')[1];
  if (!epochToken) {
    return undefined;
  }
  const parsed = Number.parseInt(epochToken, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isMatchingSessionRef = (
  type: MyOsDocumentLifecycleEventType,
  ref: string,
  sessionId: string
): boolean => {
  if (type === MYOS_DOCUMENT_CREATED) {
    return ref === sessionId;
  }
  return ref.startsWith(`${sessionId}:`);
};

export class MyOsLiveClient {
  constructor(private readonly options: RealMyOsClientOptions) {}

  private async request<T = unknown>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.options.apiKey,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MyOS request failed ${response.status}: ${body}`);
    }

    return (await response.json()) as T;
  }

  async fetchEvent(eventId: string) {
    return this.request(`/myos-events/${encodeURIComponent(eventId)}`);
  }

  async fetchDocument(sessionId: string) {
    return this.request(`/documents/${encodeURIComponent(sessionId)}`);
  }

  async bootstrapDocument(body: unknown) {
    return this.request('/documents/bootstrap', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async runDocumentOperation(
    sessionId: string,
    operation: string,
    body: unknown
  ) {
    return this.request(
      `/documents/${encodeURIComponent(sessionId)}/${encodeURIComponent(
        operation
      )}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }

  private async listEventsPage(input: {
    ref: string;
    type: MyOsDocumentLifecycleEventType;
    from?: string;
    nextPageToken?: string;
    itemsPerPage?: number;
  }): Promise<MyOsListedEventResponse> {
    const search = new URLSearchParams();
    search.set('ref', input.ref);
    search.set('type', input.type);
    search.set('itemsPerPage', String(input.itemsPerPage ?? 100));
    if (input.from) {
      search.set('from', input.from);
    }
    if (input.nextPageToken) {
      search.set('nextPageToken', input.nextPageToken);
    }

    return this.request<MyOsListedEventResponse>(
      `/myos-events?${search.toString()}`
    );
  }

  private async listEventsForSessionAndType(input: {
    sessionId: string;
    type: MyOsDocumentLifecycleEventType;
    from?: string;
    itemsPerPage?: number;
  }): Promise<MyOsRelevantEvent[]> {
    const out: MyOsRelevantEvent[] = [];
    const seenPageTokens = new Set<string>();
    let nextPageToken: string | undefined;

    while (true) {
      const page = await this.listEventsPage({
        ref: input.sessionId,
        type: input.type,
        from: input.from,
        nextPageToken,
        itemsPerPage: input.itemsPerPage,
      });

      for (const item of page.items ?? []) {
        const id = typeof item.id === 'string' ? item.id : '';
        const ref = typeof item.ref === 'string' ? item.ref : '';
        const createdAt = typeof item.created === 'string' ? item.created : '';
        if (!id || !ref || !createdAt) {
          continue;
        }
        if (!isMatchingSessionRef(input.type, ref, input.sessionId)) {
          continue;
        }

        out.push({
          id,
          type: input.type,
          createdAt,
          ref,
          sessionId: input.sessionId,
          ...(input.type === MYOS_DOCUMENT_EPOCH_ADVANCED
            ? { epoch: parseEpochFromRef(ref) }
            : {}),
        });
      }

      const token = page.nextPageToken;
      if (!token || seenPageTokens.has(token)) {
        break;
      }
      seenPageTokens.add(token);
      nextPageToken = token;
    }

    return out;
  }

  async listRelevantDocumentEvents(input: {
    sessionIds: string[];
    from?: string;
    itemsPerPage?: number;
  }): Promise<MyOsRelevantEvent[]> {
    const uniqueSessionIds = [...new Set(input.sessionIds.filter(Boolean))];
    if (uniqueSessionIds.length === 0) {
      return [];
    }

    const all = await Promise.all(
      uniqueSessionIds.flatMap(sessionId => [
        this.listEventsForSessionAndType({
          sessionId,
          type: MYOS_DOCUMENT_CREATED,
          from: input.from,
          itemsPerPage: input.itemsPerPage,
        }),
        this.listEventsForSessionAndType({
          sessionId,
          type: MYOS_DOCUMENT_EPOCH_ADVANCED,
          from: input.from,
          itemsPerPage: input.itemsPerPage,
        }),
      ])
    );

    return [...new Map(all.flat().map(item => [item.id, item])).values()];
  }
}
