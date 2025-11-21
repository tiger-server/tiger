declare module "zeromq/v5-compat.js" {
  export function socket(type: string): {
    bind(address: string): void;
    connect(address: string): void;
    subscribe(topic: string): void;
    send(payload: unknown[]): void;
    on(event: "message", handler: (...args: any[]) => void): void;
  };
}
