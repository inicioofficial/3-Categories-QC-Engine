export function AppFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`pt-1 text-center text-sm font-normal tracking-normal text-slate-500 dark:text-slate-400 ${className}`.trim()}
    >
      Powered by © 2026 INICIO TECH
    </footer>
  );
}
