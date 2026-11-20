import type { BrandVoice, ContentIdea, Workspace } from '@metaflow/shared';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BrandVoiceForm } from '@/components/ai-studio/brand-voice-form';
import { CaptionGenerator } from '@/components/ai-studio/caption-generator';
import {
  captionDefaults,
  captionValuesFromIdea,
  type CaptionFormValues,
} from '@/components/ai-studio/caption-preset';
import { GenerationHistory } from '@/components/ai-studio/generation-history';
import { HashtagGenerator } from '@/components/ai-studio/hashtag-generator';
import { IdeaGenerator } from '@/components/ai-studio/idea-generator';
import { FormAlert } from '@/components/auth/form-alert';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/auth-context';
import { useActiveWorkspace, useWorkspaces } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { fetchAiStatus, fetchBrandVoice } from '@/services/ai-studio.service';

const TABS = [
  { value: 'captions', label: 'Captions' },
  { value: 'hashtags', label: 'Hashtags' },
  { value: 'ideas', label: 'Content ideas' },
  { value: 'brand-voice', label: 'Brand voice' },
  { value: 'history', label: 'History' },
] as const;
type Tab = (typeof TABS)[number]['value'];
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value);

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; configured: boolean; voice: BrandVoice };

function Studio({ workspace }: { workspace: Workspace }) {
  const { state: auth } = useAuth();
  const { syncWorkspace } = useWorkspaces();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [captionPreset, setCaptionPreset] = useState<{
    key: number;
    values: CaptionFormValues;
  } | null>(null);
  const tabParam = searchParams.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'captions';

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchAiStatus(workspace.id, controller.signal),
      fetchBrandVoice(workspace.id, controller.signal),
    ]).then(
      ([status, voice]) => {
        setState({ status: 'ready', configured: status.configured, voice });
        setCaptionPreset((current) => current ?? { key: 0, values: captionDefaults(voice) });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [workspace.id, attempt]);

  const selectTab = (value: string) =>
    setSearchParams(value === 'captions' ? {} : { tab: value }, { replace: true });

  if (state.status === 'loading' || !captionPreset) {
    if (state.status === 'error') {
      return (
        <div className="flex flex-col items-start gap-3">
          <FormAlert message="We could not load AI Studio for this workspace." />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      );
    }
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Loading AI Studio…</span>
        <Skeleton className="h-9 w-full max-w-xl" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (state.status === 'error') return null;

  const { configured, voice } = state;
  const useIdea = (idea: ContentIdea) => {
    setCaptionPreset((current) => ({
      key: (current?.key ?? 0) + 1,
      values: captionValuesFromIdea(idea, voice),
    }));
    selectTab('captions');
  };
  const onBrandVoiceSaved = (saved: BrandVoice) => {
    setState({ status: 'ready', configured, voice: saved });
    syncWorkspace(workspace.id, {
      description: saved.description,
      defaultLanguage: saved.language,
    });
  };

  return (
    <>
      {!configured ? (
        <div role="note" className="bg-muted flex items-start gap-2 rounded-md px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            AI generation is not set up on this server yet, so the generate buttons are turned off.
            An administrator needs to connect an AI provider. You can still set up your brand voice
            and look at earlier generations.
          </p>
        </div>
      ) : null}

      {/* Panels stay mounted, so results and edits survive switching tabs. */}
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList aria-label="AI Studio tools">
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="captions" forceMount hidden={tab !== 'captions'}>
          <CaptionGenerator
            key={captionPreset.key}
            workspaceId={workspace.id}
            initialValues={captionPreset.values}
            available={configured}
          />
        </TabsContent>
        <TabsContent value="hashtags" forceMount hidden={tab !== 'hashtags'}>
          <HashtagGenerator
            workspaceId={workspace.id}
            category={workspace.category}
            language={voice.language}
            available={configured}
          />
        </TabsContent>
        <TabsContent value="ideas" forceMount hidden={tab !== 'ideas'}>
          <IdeaGenerator
            workspaceId={workspace.id}
            language={voice.language}
            available={configured}
            onUseIdea={useIdea}
          />
        </TabsContent>
        <TabsContent value="brand-voice" forceMount hidden={tab !== 'brand-voice'}>
          <BrandVoiceForm
            workspaceId={workspace.id}
            voice={voice}
            canEdit={workspace.role === 'owner'}
            onSaved={onBrandVoiceSaved}
          />
        </TabsContent>
        <TabsContent value="history" forceMount hidden={tab !== 'history'}>
          <GenerationHistory
            workspaceId={workspace.id}
            timeZone={workspace.timezone}
            currentUserId={auth.status === 'authenticated' ? auth.user.id : ''}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function AiStudioPage() {
  useDocumentTitle('AI Studio');
  const workspace = useActiveWorkspace();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="AI Studio"
        description={`Write captions, find hashtags and get post ideas for ${workspace.name}. Everything is a suggestion: check it before you post.`}
      />
      {/* Keyed by workspace: switching workspaces starts from a clean, loading studio. */}
      <Studio key={workspace.id} workspace={workspace} />
    </div>
  );
}
