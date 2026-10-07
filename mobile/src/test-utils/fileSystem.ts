/**
 * Test-only: a fake `expo-file-system` (the new `File` / `Paths` API) that
 * records what is written. Use with
 * `jest.mock('expo-file-system', () => require('@/test-utils/fileSystem').fileSystemMock)`.
 * Never import from app code.
 */

/** Every `File#write`, in order. Clear it in `beforeEach`. */
export const writtenFiles: { name: string; content: string }[] = [];

class FakeFile {
  readonly uri: string;
  readonly name: string;

  constructor(directory: { uri: string }, name: string) {
    this.name = name;
    this.uri = `${directory.uri}${name}`;
  }

  create(): void {}

  write(content: string): void {
    writtenFiles.push({ name: this.name, content });
  }
}

export const fileSystemMock = {
  __esModule: true,
  File: FakeFile,
  Paths: { cache: { uri: 'file:///cache/' } },
};
