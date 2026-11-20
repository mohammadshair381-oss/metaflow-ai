import { businessCategoryLabel, workspaceLanguageLabel } from '@metaflow/shared';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useActiveWorkspace } from '@/contexts/workspace-context';

/** The active workspace's business profile, as saved on the server. */
export function WorkspaceOverviewCard() {
  const workspace = useActiveWorkspace();
  const facts = [
    ['Category', businessCategoryLabel(workspace.category)],
    ['Time zone', workspace.timezone.replaceAll('_', ' ')],
    ['Content language', workspaceLanguageLabel(workspace.defaultLanguage)],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{workspace.name}</CardTitle>
          <Badge variant="outline">{workspace.role === 'owner' ? 'Owner' : 'Staff'}</Badge>
        </div>
        <CardDescription>{workspace.description || 'No business description yet.'}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings">
              {workspace.role === 'owner' ? 'Edit workspace' : 'View workspace details'}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
