type DocData = Record<string, unknown>;

export function createMemoryDb() {
  const docs = new Map<string, DocData>();

  function path(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  function docRef(collection: string, id: string) {
    const key = path(collection, id);
    return {
      get: async () => {
        const data = docs.get(key);
        return {
          exists: data !== undefined,
          data: () => data,
          ref: {
            set: async (partial: DocData, opts?: { merge?: boolean }) => {
              const prev = docs.get(key) ?? {};
              docs.set(
                key,
                opts?.merge ? { ...prev, ...partial } : { ...partial },
              );
            },
          },
        };
      },
      set: async (data: DocData, opts?: { merge?: boolean }) => {
        const prev = docs.get(key) ?? {};
        docs.set(key, opts?.merge ? { ...prev, ...data } : { ...data });
      },
    };
  }

  return {
    docs,
    collection: (name: string) => ({
      doc: (id: string) => docRef(name, id),
    }),
    runTransaction: async (fn: (tx: {
      get: (ref: ReturnType<typeof docRef>) => Promise<{
        exists: boolean;
        data: () => DocData | undefined;
      }>;
      set: (
        ref: ReturnType<typeof docRef>,
        data: DocData,
        opts?: { merge?: boolean },
      ) => void;
    }) => Promise<void>) => {
      const writes: Array<() => Promise<void>> = [];
      await fn({
        get: async (ref) => ref.get(),
        set: (ref, data, opts) => {
          writes.push(() => ref.set(data, opts));
        },
      });
      for (const write of writes) {
        await write();
      }
    },
  };
}
