import { Injectable } from '@nestjs/common';

export interface ChatPushPayload {
  to: string;
  title: 'BlogHub';
  body: string;
  sound: 'default';
  ttl: number;
  tag: string;
  collapseId: string;
  data: { type: 'chat_message'; conversationId: string; messageId: string };
}
export interface ExpoResult {
  status: 'ok' | 'error';
  id?: string;
  details?: { error?: string };
}
export class ExpoPushError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
export function retryableExpoError(code: string): boolean {
  return ![
    'DeviceNotRegistered',
    'MessageTooBig',
    'MismatchSenderId',
    'InvalidCredentials',
    'UNAUTHORIZED',
  ].includes(code);
}

@Injectable()
export class ExpoPushClient {
  async send(payload: ChatPushPayload): Promise<ExpoResult> {
    const response = await this.request('send', [payload]);
    const ticket = Array.isArray(response.data) ? response.data[0] : undefined;
    if (
      !this.isResult(ticket) ||
      (ticket.status === 'ok' &&
        (typeof ticket.id !== 'string' || !ticket.id || ticket.id.length > 255))
    ) {
      throw new ExpoPushError('invalid_ticket_response', true);
    }
    return ticket;
  }

  async receipt(ticketId: string): Promise<ExpoResult | null> {
    const response = await this.request('getReceipts', { ids: [ticketId] });
    const receipt =
      response.data &&
      typeof response.data === 'object' &&
      !Array.isArray(response.data)
        ? Reflect.get(response.data, ticketId)
        : undefined;
    if (
      receipt === undefined &&
      response.data &&
      typeof response.data === 'object' &&
      !Array.isArray(response.data)
    )
      return null;
    if (!this.isResult(receipt))
      throw new ExpoPushError('invalid_receipt_response', true);
    return receipt;
  }

  private isResult(value: unknown): value is ExpoResult {
    if (!value || typeof value !== 'object') return false;
    const status = Reflect.get(value, 'status');
    return status === 'ok' || status === 'error';
  }

  private async request(
    path: 'send' | 'getReceipts',
    body: unknown,
  ): Promise<{ data?: unknown }> {
    let response: Response;
    try {
      response = await fetch(`https://exp.host/--/api/v2/push/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch {
      throw new ExpoPushError('expo_network_error', true);
    }
    if (!response.ok)
      throw new ExpoPushError(
        `expo_http_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    let json: { data?: unknown; errors?: { code?: string }[] };
    try {
      json = await response.json();
    } catch {
      throw new ExpoPushError('invalid_expo_json', true);
    }
    if (!json || typeof json !== 'object')
      throw new ExpoPushError('invalid_expo_response', true);
    if (Array.isArray(json.errors) && json.errors.length) {
      const code =
        typeof json.errors[0]?.code === 'string'
          ? json.errors[0].code.slice(0, 80)
          : 'expo_request_error';
      throw new ExpoPushError(code, retryableExpoError(code));
    }
    return json;
  }
}
