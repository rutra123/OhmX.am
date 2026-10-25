// Minimal typing for better-sqlite3 (no @types package installed). Type-only: no runtime effect.
declare module 'better-sqlite3' {
  namespace Database {
    interface Statement {
      run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
      get(...params: any[]): any;
      all(...params: any[]): any[];
      iterate(...params: any[]): IterableIterator<any>;
      [key: string]: any;
    }
    interface Database {
      prepare(sql: string): Statement;
      exec(sql: string): Database;
      pragma(source: string, options?: { simple?: boolean }): any;
      transaction<F extends (...args: any[]) => any>(fn: F): F & { deferred: F; immediate: F; exclusive: F };
      close(): Database;
      [key: string]: any;
    }
  }
  const Database: {
    new (filename?: string | Buffer, options?: Record<string, unknown>): Database.Database;
    (filename?: string | Buffer, options?: Record<string, unknown>): Database.Database;
  };
  export = Database;
}
