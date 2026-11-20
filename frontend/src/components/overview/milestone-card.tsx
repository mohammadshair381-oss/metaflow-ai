import { CircleCheck, CircleDashed } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const BUILT_IN_THIS_MILESTONE = [
  'React web app with routing (this page)',
  'API with liveness and readiness checks',
  'MongoDB readiness reporting',
  'Credentialed CORS between web app and API',
  'Accounts, sign-in and secure sessions',
  'Workspaces with owner and staff roles',
];

const COMING_NEXT = [
  'Facebook Page and Instagram connections',
  'AI Studio for captions and hashtags',
  'Scheduling, approvals and publishing',
];

export function MilestoneCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Build progress</CardTitle>
        <CardDescription>Product features arrive milestone by milestone.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <div className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Built
          </h3>
          <ul className="flex flex-col gap-2">
            {BUILT_IN_THIS_MILESTONE.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CircleCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Planned
          </h3>
          <ul className="text-muted-foreground flex flex-col gap-2">
            {COMING_NEXT.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
