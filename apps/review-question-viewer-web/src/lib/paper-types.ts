export type NodeKind = 'question' | 'subquestion' | 'subsubquestion';
export type TagSource = 'explicit' | 'inherited' | 'implicit';

export type ViewerTarget = {
  questionUuid: string;
  relativePathFromPapers: string;
};

export type ViewerSessionSummary = {
  createdAt: number;
  hasTarget: boolean;
  sessionId: string;
  target: ViewerTarget | null;
  updatedAt: number | null;
};

export type DisplayTag = {
  source: TagSource;
  value: string;
};

export type RagState = {
  key: string;
  label: string;
  rawValue: string;
  tone:
    | 'blocked'
    | 'comingsoon'
    | 'g0'
    | 'ng0'
    | 'ng1'
    | 'ng2'
    | 'ng3'
    | 'ng4'
    | 'ng5'
    | 'ng6'
    | 'ng7'
    | 'ng8'
    | 'notstarted'
    | 'review-danger'
    | 'review-pending'
    | 'review-success'
    | 'review-warning'
    | 'unknown';
  value: string;
};

export type ReviewScopeMetadata = {
  comments: string;
  reviewRag: RagState | null;
  sheet: string | null;
  sourceRag: RagState | null;
};

export type ReviewMetadata = {
  answer: ReviewScopeMetadata;
  question: ReviewScopeMetadata;
};

export type OriginalQuestionSource = {
  paperStem: string | null;
  questionNumber: number | null;
  rawValue: string;
  sectionNumber: number | null;
};

export type RawWorking = {
  formulas: Array<{ formula: string }>;
  tips: Array<{ tip: string }>;
  working: string;
};

export type RawAnswer = {
  answer: string;
  key: string;
  option: string;
};

export type RenderedNodeContent = {
  answers: string[];
  formulas: string[];
  question: string;
  tips: string[];
  workings: string[];
};

export type RawNodeContent = {
  answers: RawAnswer[];
  question: string;
  workings: RawWorking[];
};

export type QuestionNode = {
  children: QuestionNode[];
  content: {
    raw: RawNodeContent;
    rendered: RenderedNodeContent;
  };
  depth: number;
  effectiveTags: DisplayTag[];
  explicitTags: string[];
  hierarchyLabel: string;
  inheritedTags: string[];
  isRootNode: boolean;
  kind: NodeKind;
  path: string;
  originalSource: OriginalQuestionSource | null;
  questionId: string | null;
  ragStates: RagState[];
  review: ReviewMetadata;
  sourceId: string;
  uuid: string | null;
};

export type QuestionPayload = {
  document: {
    fileName: string;
    relativePathFromPapers: string;
    title: string;
    versionHash: string;
  };
  question: QuestionNode;
  target: ViewerTarget;
};

export type CurrentQuestionResponse =
  | {
      ok: true;
      payload: QuestionPayload;
      sessionId: string;
    }
  | {
      error: string;
      ok: false;
      sessionId: string;
      target: ViewerTarget | null;
    };

export type SessionsResponse = {
  ok: true;
  sessions: ViewerSessionSummary[];
};
