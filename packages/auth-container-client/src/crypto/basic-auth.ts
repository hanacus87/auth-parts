/**
 * RFC 6749 §2.3.1: Authorization: Basic base64(urlEncode(client_id):urlEncode(client_secret))。
 * client_secret に : や非 ASCII を含んでも安全に扱えるよう encodeURIComponent を噛ませる。
 */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const encoded = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
  return "Basic " + btoa(encoded);
}
