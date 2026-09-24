declare module 'tesseract.js' {
  const Tesseract: {
    recognize(image: string, lang: string, options?: any): Promise<{ data: { text: string } }>;
    createWorker(lang: string): Promise<any>;
  };
  export default Tesseract;
}
