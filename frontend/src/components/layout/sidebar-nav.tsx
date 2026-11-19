import { NavLink } from 'react-router-dom';
import { NAVIGATION } from '@/routes/navigation';
import { cn } from '@/lib/utils';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAVIGATION.map((section, sectionIndex) => (
        <div key={section.title ?? sectionIndex} className="flex flex-col gap-1">
          {section.title ? (
            <p className="text-muted-foreground px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
              {section.title}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : item.planned
                            ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            : 'text-sidebar-foreground hover:bg-muted',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                    {item.planned ? (
                      <span
                        className="bg-muted text-muted-foreground ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                        title="Not built yet"
                      >
                        Soon
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
