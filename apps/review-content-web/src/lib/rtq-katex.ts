import { getRtqReviewKatexOptions } from '@rtq/review-katex-options';

const reviewerKatexMacros: Record<string, string> = {
  '\\addCarryOver': '\\scriptstyle \\grayF',
  '\\boxedEmptyValue': '\\boxed{\\phantom{9}}',
  '\\boxedFilledValue': '\\boxed{\\filledValue{#1}}',
  '\\filledValue': '\\textcolor{green}{#1}',
  '\\green': '\\textcolor{green}{#1}',
  '\\incorrectValue': '\\textcolor{red}{#1}',
  '\\maroonC': '\\textcolor{##ed5fa6}{#1}',
  '\\multiplyCarryOver': '\\scriptstyle \\grayF{#1}',
  '\\red': '\\textcolor{red}{#1}',
  '\\sequenceStep': '\\maroonC{\\footnotesize{(#1)}}',
  '\\sequenceStepBare': '\\maroonC{\\footnotesize{#1}}',
  '\\solvedOrder': '\\maroonC{\\footnotesize{(#1)}}',
  '\\solvedOrderPhantom': '\\phantom{\\maroonC{\\footnotesize{(#1)}}}',
  '\\subtractBorrow': '\\textstyle \\green',
};

export const rtqKatexOptions = getRtqReviewKatexOptions(reviewerKatexMacros);
export const rtqKatexMacros = rtqKatexOptions.macros;
