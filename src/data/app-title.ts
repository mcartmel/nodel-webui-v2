export const NODEL_APP_TITLE_CHANGE = 'nodel-app-title-change';

export interface NodelAppTitleChangeDetail {
  title: string | null;
}

export interface NodelAppTitleHost {
  getSignalTitle(): string | null;
}
