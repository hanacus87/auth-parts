import type { CallbackErrorKind } from "./types";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class CookieSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieSizeError";
  }
}

export class CallbackError extends Error {
  kind: CallbackErrorKind;

  constructor(kind: CallbackErrorKind, message: string) {
    super(message);
    this.name = "CallbackError";
    this.kind = kind;
  }
}
