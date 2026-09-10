export const DIMENSIONAL_TAG_AXES = [
  'family',
  'math',
  'frame',
  'marker',
  'reasoning',
] as const;

export const REVIEWABLE_COLLECTION_IDS = [
  'toml',
  'allTopicsToml',
  'focusToml',
  'focusTopicToml',
  'focusRagToml',
  'focusRagTopicToml',
  'topicToml',
  'ragToml',
  'ragTopicToml',
] as const;

export type DimensionalTagAxis = (typeof DIMENSIONAL_TAG_AXES)[number];
export type RegisteredPaperCollectionId =
  (typeof REVIEWABLE_COLLECTION_IDS)[number];
export type ExemplarPaperCollectionId = `exemplarsLevel${number}Toml`;
export type PaperCollectionId =
  RegisteredPaperCollectionId | ExemplarPaperCollectionId;

export type DimensionalTagOrigin = 'explicit' | 'inherited' | 'implicit';

export type EffectiveDimensionalTag = Readonly<{
  axis: DimensionalTagAxis;
  inheritedFromNodeId?: string;
  origin: DimensionalTagOrigin;
  value: string;
}>;

export type PaperCollection = Readonly<{
  description: string;
  directory: PaperCollectionId;
  exemplarLevel?: number;
  generated: boolean;
  id: PaperCollectionId;
  label: string;
  readOnly: true;
}>;

export type PaperSourceProvenance = Readonly<{
  kind: 'canonical' | 'derived' | 'exemplar';
  sourcePaperStems: readonly string[];
}>;

export type PaperSource = Readonly<{
  collection: PaperCollection;
  fileName: string;
  focusGroups: readonly string[];
  provenance: PaperSourceProvenance;
  questionCount: number;
  ragGrouping?: string;
  relativePath: string;
  title: string;
  topic?: string;
  version: string;
}>;

export type PaperSourceSummary =
  | Readonly<{
      source: PaperSource;
      state: 'ready';
    }>
  | Readonly<{
      collection: PaperCollection;
      fileName: string;
      message: string;
      relativePath: string;
      state: 'invalid';
      title: string;
      version: string;
    }>;

export type ReviewMacroKind = 'formula' | 'shared' | 'tip' | 'working';

export type ReviewMacroEntry = Readonly<{
  expanded: string;
  kind: ReviewMacroKind;
  name: string;
  source: string;
}>;

export type ReviewMacroDocument = Readonly<{
  entries: readonly ReviewMacroEntry[];
  fileName: 'macros.toml';
  rawSource: string;
  repositoryPath: string;
}>;

export type ReviewAssetContext = Readonly<{
  answerIndex?: number;
  paperStem: string;
  questionIndex: number;
  scope: 'answer' | 'question' | 'working';
  sectionIndex: number;
  subquestionIndex?: number;
  subSubquestionIndex?: number;
  workingIndex?: number;
}>;

export type ReviewPaperTablePreparation = Readonly<{
  attributes: Readonly<Record<string, string>>;
  kind: 'paper-table';
  markdown: string;
}>;

export type ReviewPaperImagePreparation = Readonly<{
  attributes: Readonly<Record<string, string>>;
  context: ReviewAssetContext;
  kind: 'paper-image';
}>;

export type ReviewLongDivisionPreparation = Readonly<{
  attributes: Readonly<Record<string, string>>;
  context: ReviewAssetContext;
  kind: 'long-division';
}>;

export type ReviewContentPreparation =
  | ReviewPaperTablePreparation
  | ReviewPaperImagePreparation
  | ReviewLongDivisionPreparation;

export type ReviewContentField = Readonly<{
  context: ReviewAssetContext;
  expanded: string;
  preparations: readonly ReviewContentPreparation[];
  raw: string;
}>;

export type ReviewWorking = Readonly<{
  formulas: readonly ReviewContentField[];
  tips: readonly ReviewContentField[];
  working: ReviewContentField;
}>;

export type ReviewAnswer = Readonly<{
  answer: ReviewContentField;
  key: ReviewContentField;
  option: ReviewContentField;
}>;

export type OriginalQuestionSource = Readonly<{
  paperStem?: string;
  questionNumber?: number;
  rawValue: string;
  sectionNumber?: number;
}>;

export type ReviewTargetState = Readonly<{
  contentRag?: string;
  legacyComments: string;
  reviewOutcome?: string;
  uuid?: string;
}>;

export type ReviewPaperNode = Readonly<{
  children: readonly ReviewPaperNode[];
  content: Readonly<{
    answers: readonly ReviewAnswer[];
    question: ReviewContentField;
    workings: readonly ReviewWorking[];
  }>;
  depth: 0 | 1 | 2;
  effectiveTags: readonly EffectiveDimensionalTag[];
  explicitInherit: boolean | null;
  explicitTags: readonly string[];
  id: string;
  inheritedTags: readonly EffectiveDimensionalTag[];
  kind: 'question' | 'subquestion' | 'sub-subquestion';
  label: string;
  originalSource?: OriginalQuestionSource;
  questionId?: string;
  review: Readonly<{
    answer: ReviewTargetState;
    question: ReviewTargetState;
  }>;
  sourceQuestionId?: string;
  uuid?: string;
}>;

export type ReviewPaperMetadata = Readonly<{
  accessTier?: string;
  focusGroups: readonly string[];
  paperId?: string;
  paperRag?: string;
  schoolIds: readonly string[];
  year?: string;
}>;

export type ReviewPaper = Readonly<{
  metadata: ReviewPaperMetadata;
  sections: readonly Readonly<{
    id: string;
    label: string;
    questions: readonly ReviewPaperNode[];
  }>[];
  source: PaperSource;
  title: string;
}>;

export type DimensionalFilterSelection = Readonly<
  Record<DimensionalTagAxis, readonly string[]>
>;

export type ReviewStateFilterSide = 'answer' | 'question';
export type ReviewOutcomeFilterSide = ReviewStateFilterSide;

export type ReviewOutcomeFilterContext = Readonly<{
  values: Readonly<
    Record<
      string,
      Readonly<Record<ReviewOutcomeFilterSide, string | null | undefined>>
    >
  >;
}>;

export type ReviewFilterSelection = DimensionalFilterSelection &
  Readonly<{
    answerRag: readonly string[];
    answerReview: readonly string[];
    questionRag: readonly string[];
    questionReview: readonly string[];
  }>;

export type DimensionalFacetOption = Readonly<{
  count: number;
  disabled: boolean;
  selected: boolean;
  value: string;
}>;

export type DimensionalFacet = Readonly<{
  axis: DimensionalTagAxis;
  label: string;
  options: readonly DimensionalFacetOption[];
}>;

export type ReviewStateFacet = Readonly<{
  label: string;
  options: readonly DimensionalFacetOption[];
  parameter: 'answerRag' | 'questionRag';
  side: ReviewStateFilterSide;
}>;

export type ReviewOutcomeFacet = Readonly<{
  label: string;
  options: readonly DimensionalFacetOption[];
  parameter: 'answerReview' | 'questionReview';
  side: ReviewOutcomeFilterSide;
}>;

export type QuestionTreeMatch = Readonly<{
  matchingNodeIds: readonly string[];
  questionId: string;
  sectionId: string;
}>;

export type DimensionalFilterResult = Readonly<{
  facets: readonly DimensionalFacet[];
  matchingNodeIds: readonly string[];
  matchingSections: readonly Readonly<{
    id: string;
    label: string;
    questions: readonly ReviewPaperNode[];
  }>[];
  matchingQuestionTreeCount: number;
  matchingQuestionTreeIds: readonly string[];
  questionTreeMatches: readonly QuestionTreeMatch[];
  reviewOutcomeFacets: readonly ReviewOutcomeFacet[];
  selection: ReviewFilterSelection;
  stateFacets: readonly ReviewStateFacet[];
  totalQuestionTreeCount: number;
}>;

export type ContentWorkspaceStatus =
  | Readonly<{
      assetsPackage: '@rtq/maths-assets';
      papersPackage: '@rtq/papers';
      source: 'rtq-content';
      state: 'ready';
    }>
  | Readonly<{
      message: string;
      source: 'rtq-content';
      state: 'unavailable';
    }>;
