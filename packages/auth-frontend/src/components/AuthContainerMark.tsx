interface Props {
  className?: string;
  strokeWidth?: number;
}

/** AuthContainer のブランドマーク。コンテナ (箱) + 南京錠 + 鍵穴の組み合わせで認証コンテナを表現する。 */
export function AuthContainerMark({ className, strokeWidth = 2 }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 9V6.5a3 3 0 0 1 6 0V9" />
      <rect x="4" y="9" width="16" height="12" rx="1.8" />
      <circle cx="12" cy="14" r="1.2" />
      <path d="M12 15.2V17.2" />
    </svg>
  );
}
