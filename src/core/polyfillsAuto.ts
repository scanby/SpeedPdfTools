// Polyfills defensivos para Chromium 108 (Electron 22 / Windows 7) y Web Workers de pdfjs-dist

type PromiseWithResolversFn = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseTryFn = <T, Args extends unknown[]>(
  fn: (...args: Args) => T | PromiseLike<T>,
  ...args: Args
) => Promise<T>;

const PromiseCtor = globalThis.Promise as PromiseConstructor & {
  withResolvers?: PromiseWithResolversFn;
  try?: PromiseTryFn;
};

if (typeof PromiseCtor.withResolvers !== 'function') {
  PromiseCtor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (typeof PromiseCtor.try !== 'function') {
  PromiseCtor.try = function promiseTry<T, Args extends unknown[]>(
    fn: (...args: Args) => T | PromiseLike<T>,
    ...args: Args
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      resolve(fn(...args));
    });
  };
}

const UrlCtor = globalThis.URL as
  | (typeof URL & {
      canParse?: (url: string, base?: string) => boolean;
      parse?: (url: string, base?: string) => URL | null;
    })
  | undefined;

if (UrlCtor && typeof UrlCtor.canParse !== 'function') {
  UrlCtor.canParse = (url: string, base?: string) => {
    try {
      new URL(url, base);
      return true;
    } catch {
      return false;
    }
  };
}

if (UrlCtor && typeof UrlCtor.parse !== 'function') {
  UrlCtor.parse = (url: string, base?: string) => {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  };
}

const ArrayProto = Array.prototype as unknown as {
  toSorted?: <T>(compareFn?: (a: T, b: T) => number) => T[];
  toReversed?: <T>() => T[];
};

if (typeof ArrayProto.toSorted !== 'function') {
  Object.defineProperty(Array.prototype, 'toSorted', {
    configurable: true,
    writable: true,
    value: function toSorted<T>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
      return [...this].sort(compareFn);
    },
  });
}

if (typeof ArrayProto.toReversed !== 'function') {
  Object.defineProperty(Array.prototype, 'toReversed', {
    configurable: true,
    writable: true,
    value: function toReversed<T>(this: T[]): T[] {
      return [...this].reverse();
    },
  });
}

const ObjectCtor = Object as typeof Object & {
  groupBy?: <K extends PropertyKey, T>(
    items: Iterable<T>,
    keySelector: (item: T, index: number) => K
  ) => Partial<Record<K, T[]>>;
};

if (typeof ObjectCtor.groupBy !== 'function') {
  ObjectCtor.groupBy = function groupBy<K extends PropertyKey, T>(
    items: Iterable<T>,
    keySelector: (item: T, index: number) => K
  ) {
    const out = Object.create(null) as Partial<Record<K, T[]>>;
    let index = 0;
    for (const item of items) {
      const key = keySelector(item, index++);
      const bucket = out[key];
      if (bucket) {
        bucket.push(item);
      } else {
        out[key] = [item];
      }
    }
    return out;
  };
}

const MapCtor = Map as typeof Map & {
  groupBy?: <K, T>(
    items: Iterable<T>,
    keySelector: (item: T, index: number) => K
  ) => Map<K, T[]>;
};

if (typeof MapCtor.groupBy !== 'function') {
  MapCtor.groupBy = function groupBy<K, T>(
    items: Iterable<T>,
    keySelector: (item: T, index: number) => K
  ) {
    const out = new Map<K, T[]>();
    let index = 0;
    for (const item of items) {
      const key = keySelector(item, index++);
      const bucket = out.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        out.set(key, [item]);
      }
    }
    return out;
  };
}

export {};
