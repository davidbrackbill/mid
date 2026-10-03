interface ImportMeta {
  readonly hot?: {
    accept(): void;
    dispose(callback: () => void): void;
  };
}
