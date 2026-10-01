/**
 * 并发冲突错误：多标签页同时修改同一泊位时，乐观锁版本不一致，
 * 抛出此错误以中止写入，避免旧标签页覆盖新数据。
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
