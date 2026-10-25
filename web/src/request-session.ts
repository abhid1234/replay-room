export class RequestSessionCancelledError extends Error {
  constructor() {
    super("Operator session changed while the request was running");
    this.name = "RequestSessionCancelledError";
  }
}

export class OperatorRequestSession {
  private generation = 0;
  private readonly controllers = new Set<AbortController>();

  async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const result = await operation(controller.signal);
      if (controller.signal.aborted || generation !== this.generation) {
        throw new RequestSessionCancelledError();
      }
      return result;
    } catch (error) {
      if (error instanceof RequestSessionCancelledError
        || controller.signal.aborted
        || generation !== this.generation
        || isAbortError(error)) {
        throw new RequestSessionCancelledError();
      }
      throw error;
    } finally {
      this.controllers.delete(controller);
    }
  }

  invalidate(): void {
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
