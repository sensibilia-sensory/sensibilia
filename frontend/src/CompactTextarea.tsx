import { useLayoutEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

/** Keep short prompts to one row and expand longer wording without hiding it. */
export function CompactTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    function resize() {
      element!.style.height = 'auto';
      element!.style.height = `${element!.scrollHeight + 2}px`;
    }
    resize();
    let width = -1;
    const observer = new ResizeObserver((entries) => {
      if (entries[0].contentRect.width === width) return;
      width = entries[0].contentRect.width;
      resize();
    });
    // Observe the parent width; observing our own height would feed back into resizing.
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={input} rows={1} />;
}
