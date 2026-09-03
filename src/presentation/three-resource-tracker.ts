export interface DisposableThreeResource {
  dispose(): void;
}

/** Registers shared WebGL resources exactly once and disposes them idempotently. */
export class ThreeResourceTracker {
  private readonly resources = new Set<DisposableThreeResource>();
  private disposedValue = false;

  public register<T extends DisposableThreeResource>(resource: T): T {
    if (this.disposedValue) {
      resource.dispose();
      return resource;
    }
    this.resources.add(resource);
    return resource;
  }

  public get size(): number {
    return this.resources.size;
  }

  public get disposed(): boolean {
    return this.disposedValue;
  }

  public dispose(): void {
    if (this.disposedValue) return;
    this.disposedValue = true;
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}
