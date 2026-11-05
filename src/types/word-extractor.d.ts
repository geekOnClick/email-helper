/**
 * Ambient-декларация для `word-extractor` (читает legacy .doc и OOXML .docx).
 * Пакет не поставляет собственные типы; используем минимальный контракт,
 * покрывающий нужный API: `new WordExtractor()` → `extract(path|Buffer)`
 * → `Document.getBody(): string`.
 */
declare module 'word-extractor' {
  /** Документ Word, возвращаемый `WordExtractor.extract`. */
  export interface Document {
    /** Основной текст документа. */
    getBody(): string;
  }

  /** Экстрактор текста из .doc/.docx. */
  export default class WordExtractor {
    /**
     * Извлекает текст из файла Word.
     * @param input — путь к файлу или Buffer с содержимым.
     */
    extract(input: string | Buffer): Promise<Document>;
  }
}
