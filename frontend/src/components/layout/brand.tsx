import { APP_NAME } from '@metaflow/shared';
import { Link } from 'react-router-dom';
import logoMark from '@/assets/logo-mark.svg';

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-md outline-offset-4">
      <img src={logoMark} alt="" aria-hidden className="size-8 rounded-lg shadow-sm" />
      <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
    </Link>
  );
}
