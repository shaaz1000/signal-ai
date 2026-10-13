import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { hrefToHash, navigateTo } from '../platform';

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  children?: ReactNode;
}

/** Stand-in for next/link: the same paths, expressed as hash routes the Artifact frame allows. */
export default function Link({ href, onClick, children, ...rest }: Props) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigateTo(href);
  };
  return <a href={hrefToHash(href)} onClick={click} {...rest}>{children}</a>;
}
