import { APP_NAME } from '@metaflow/shared';
import { useEffect } from 'react';

/** Sets the browser tab title, e.g. "AI Studio · MetaFlow AI". */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
