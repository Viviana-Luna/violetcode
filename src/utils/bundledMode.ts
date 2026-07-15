/** 判断当前进程是否由 Bun 运行。 */
export function isRunningWithBun(): boolean {
  return process.versions.bun !== undefined
}

/**
 * 判断当前进程是否为 Bun standalone 可执行文件。
 * 无额外资源的编译产物不会出现在 Bun.embeddedFiles 中，但入口仍位于 bunfs。
 */
export function isInBundledMode(): boolean {
  return (
    typeof Bun !== 'undefined' &&
    ((Array.isArray(Bun.embeddedFiles) && Bun.embeddedFiles.length > 0) ||
      Bun.main.startsWith('/$bunfs/root/'))
  )
}
