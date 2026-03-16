type SidebarNavIconProps = {
  className?: string;
};

export function OverviewIcon({ className }: SidebarNavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? 'h-full w-full'}
      viewBox="0 0 19.5 21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.75 0.75L0.75 9.10714V18.8571C0.75 19.6264 1.32563 20.25 2.03571 20.25H7.17857V16.0714C7.17857 14.5329 8.32984 13.2857 9.75 13.2857C11.1702 13.2857 12.3214 14.5329 12.3214 16.0714V20.25H17.4643C18.1744 20.25 18.75 19.6264 18.75 18.8571V9.10714L9.75 0.75Z"
        strokeLinecap="square"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CardsIcon({ className }: SidebarNavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? 'h-full w-full'}
      viewBox="0 0 21 16.5"
      fill="currentColor"
    >
      <path d="M17.625 0C19.489 0 21 1.51104 21 3.375V13.125C21 14.989 19.489 16.5 17.625 16.5H3.375C1.51104 16.5 0 14.989 0 13.125V3.375C0 1.51104 1.51104 0 3.375 0H17.625ZM1.5 13.125C1.5 14.1605 2.33947 15 3.375 15H17.625C18.6605 15 19.5 14.1605 19.5 13.125V6.65625H1.5V13.125ZM6.89355 8.91309C7.60279 8.98498 8.15625 9.5843 8.15625 10.3125V11.25L8.14941 11.3936C8.07752 12.1028 7.4782 12.6562 6.75 12.6562H4.5C3.72335 12.6562 3.09375 12.0267 3.09375 11.25V10.3125C3.09375 9.53585 3.72335 8.90625 4.5 8.90625H6.75L6.89355 8.91309ZM3.375 1.5C2.33947 1.5 1.5 2.33947 1.5 3.375V3.84375H19.5V3.375C19.5 2.33947 18.6605 1.5 17.625 1.5H3.375Z" />
    </svg>
  );
}

export function TransactionsIcon({ className }: SidebarNavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? 'h-full w-full'}
      viewBox="0 0 16.5 21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 0.75L15.75 6L10.5 11.25M14.947 6H0.75M6 20.25L0.75 15L6 9.75M1.59375 15H15.75"
      />
    </svg>
  );
}

export function ContractsIcon({ className }: SidebarNavIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? 'h-full w-full'}
      viewBox="0 0 16.5 21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 1.125V6.75C8.25 7.14782 8.40804 7.52936 8.68934 7.81066C8.97064 8.09196 9.35218 8.25 9.75 8.25H15.375M15.75 8.87109V18C15.75 18.5967 15.5129 19.169 15.091 19.591C14.669 20.0129 14.0967 20.25 13.5 20.25H3C2.40326 20.25 1.83097 20.0129 1.40901 19.591C0.987053 19.169 0.75 18.5967 0.75 18V3C0.75 2.40326 0.987053 1.83097 1.40901 1.40901C1.83097 0.987053 2.40326 0.75 3 0.75H7.62891C8.02659 0.75006 8.40798 0.908044 8.68922 1.18922L15.3108 7.81078C15.592 8.09202 15.7499 8.47341 15.75 8.87109Z"
      />
    </svg>
  );
}
