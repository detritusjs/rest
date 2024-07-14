declare module 'undici/lib/web/fetch/body' {
  export function extractBody(body: any, keepalive?: boolean): [ any, string];
}
