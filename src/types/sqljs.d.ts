declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[];
    values: Array<Array<string | number | Uint8Array | null>>;
  }

  export class Database {
    constructor(data?: Uint8Array | Buffer);
    run(sql: string, params?: Record<string, unknown>): void;
    exec(sql: string, params?: Record<string, unknown>): QueryExecResult[];
    export(): Uint8Array;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export default function initSqlJs(config?: { locateFile?: (file: string) => string; wasmBinary?: Uint8Array | Buffer }): Promise<SqlJsStatic>;
}
