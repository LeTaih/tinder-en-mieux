export type PromptAnswer = { question: string; answer: string };
export type RichProfileFields = {
  job: string | null;
  education: string | null;
  height_cm: number | null;
  interests: string[];
  prompts: PromptAnswer[];
};
