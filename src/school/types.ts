// =============================================================================
//  School (ADR-046): lessons with three separate tracks.
//    theory    - text, then a multiple-choice test on it;
//    situations - a scene (map, draft, items) and "what do you do", with the reason;
//                 authored, or generated from the knowledge base (items / draft);
//    practice  - a measurable goal checked on your own reviewed matches.
//  Content is data; no DOM here.
// =============================================================================

export interface Question {
  id: string;
  q: string;
  options: string[];
  /** index into options. */
  correct: number;
  /** why the right answer is right (and the trap in the others). */
  why: string;
}

export interface Situation extends Question {
  /** the scene: what you see / what happened. */
  scene: string;
}

export interface TheoryBlock {
  h: string;
  /** paragraphs; **bold** and lists ("- ") are rendered. */
  p: string[];
}

export type GoalId = "cs10" | "nw20" | "xp10" | "deaths" | "idle" | "observers" | "stacks" | "dewards" | "kp" | "answers";

export interface PracticeGoal {
  id: GoalId;
  /** what to do in your next games. */
  text: string;
  /** the threshold, when the goal's default does not fit this lesson (see practice.ts). */
  target?: number;
  /** positions the goal is for (undefined = all). */
  roles?: number[];
  /** matches that must meet it, out of the last `of` reviewed with this role. */
  need: number;
  of: number;
}

export interface Lesson {
  id: string;
  title: string;
  /** one line under the title. */
  lead: string;
  theory: TheoryBlock[];
  quiz: Question[];
  situations: Situation[];
  /** situations generated from the knowledge base (src/school/generate.ts). */
  generated?: "items" | "draft" | "mechanism" | "itemtool" | "builds" | "timing";
  practice: PracticeGoal[];
}

export interface Module {
  id: string;
  title: string;
  /** patch the facts were checked against. */
  patch: string;
  checked: string;
  lessons: Lesson[];
}
