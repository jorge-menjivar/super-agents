import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type { Log } from '@shared/types/data/log';
import { produceSuperAgentsRequestData } from '@shared/utils/sa-request-data';

/**
 * The exchange a log has to show: the request, and the answer when there is
 * one.
 *
 * Once a provider has answered, that is the body the gateway sent and the
 * body that came back. Until then -- a request still running, or one that
 * failed before a provider was reached -- it is the request the client made,
 * recorded when the row opened. That is the whole point of opening the row
 * early: there is something to read before the answer exists, so a request
 * in flight shows its own conversation rather than an empty card.
 *
 * `origin` is where the request arrived, since the row keeps the path it was
 * served on rather than a whole URL.
 *
 * Null when the row carries neither, and when the route or the body shape is
 * one this build can no longer parse: that should cost the log its view, not
 * the dashboard its page.
 */
export function exchangeOf(
  log: Log,
  origin: string,
): SuperAgentsRequestData | null {
  const provider = log.ai_provider_request_log;
  const sent = provider
    ? {
        method: provider.method,
        url: provider.request_url,
        requestBody: provider.request_body,
        responseBody: provider.response_body,
      }
    : log.request_body
      ? {
          method: log.method,
          url: new URL(log.endpoint, origin).href,
          requestBody: log.request_body,
          responseBody: null,
        }
      : null;

  if (!sent) return null;

  try {
    return produceSuperAgentsRequestData(
      sent.method,
      sent.url,
      {},
      sent.requestBody,
      sent.responseBody,
    );
  } catch (error) {
    console.error('Failed to parse the log request data:', error);
    return null;
  }
}
