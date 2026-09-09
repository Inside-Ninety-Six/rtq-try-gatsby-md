import { openReviewStore, REVIEW_DATABASE_PATH } from "./review-store.ts";

const store = openReviewStore();
store.close();
console.log(`Review-store migrations are current: ${REVIEW_DATABASE_PATH}`);
