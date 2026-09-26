export function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const paths = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></>,
    clients: <><path d="M16 21v-1.7a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21" /><circle cx="9" cy="7" r="3.2" /><path d="M22 21v-1.6a4 4 0 0 0-3-3.85M16.5 4.3a3.2 3.2 0 0 1 0 6.2" /></>,
    vendors: <><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10.5V20h14v-9.5" /><path d="M8 20v-6h8v6" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    chevronDown: <path d="m7 9 5 5 5-5" />,
    first: <><path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" /></>,
    last: <><path d="m13 7 5 5-5 5" /><path d="m6 7 5 5-5 5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    user: <><circle cx="12" cy="8" r="3.3" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /><path d="M3 8 8 3M21 8l-5-5M21 16l-5 5M3 16l5 5" /></>,
    close: <><path d="M6 6l12 12M18 6 6 18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="M12 3.5 21 19H3l9-15.5Z" /><path d="M12 9v4M12 16.5h.01" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h5" /></>,
    eye: <><path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.3" /></>,
    download: <><path d="M12 4v10" /><path d="m8 10 4 4 4-4" /><path d="M5 20h14" /></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m14 6 4 4" /></>,
    trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
    whatsapp: <><path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.5-4.3A8.5 8.5 0 1 1 20.5 11.5Z" /><path d="M8.8 8.2c1 2.4 2.6 4 5 5 .8.3 1.4-.2 1.8-.8" /></>,
    retry: <><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></>,
    phone: <path d="M6.5 3h-2A1.5 1.5 0 0 0 3 4.6C3 13.1 10.9 21 19.4 21a1.5 1.5 0 0 0 1.6-1.5v-2a1.2 1.2 0 0 0-1-1.2l-3-.6a1.2 1.2 0 0 0-1.2.5l-1 1.4a13.5 13.5 0 0 1-5.4-5.4l1.4-1a1.2 1.2 0 0 0 .5-1.2l-.6-3a1.2 1.2 0 0 0-1.2-1Z" />,
    phoneDown: <><path d="M2.5 14.2a13 13 0 0 1 19 0" /><path d="m6.6 12.2-.6 2.6a1.1 1.1 0 0 1-1.3.8l-2.2-.5" /><path d="m17.4 12.2.6 2.6a1.1 1.1 0 0 0 1.3.8l2.2-.5" /><path d="M9.6 10.6v2.6M14.4 10.6v2.6" /></>,
    phoneMissed: <><path d="M6.5 3h-2A1.5 1.5 0 0 0 3 4.6C3 13.1 10.9 21 19.4 21a1.5 1.5 0 0 0 1.6-1.5v-2a1.2 1.2 0 0 0-1-1.2l-3-.6a1.2 1.2 0 0 0-1.2.5l-1 1.4a13.5 13.5 0 0 1-5.4-5.4l1.4-1a1.2 1.2 0 0 0 .5-1.2l-.6-3a1.2 1.2 0 0 0-1.2-1Z" /><path d="M15 3.5 21 9.5M21 3.5l-6 6" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3" /></>,
    micOff: <><path d="M9 6.2V6a3 3 0 0 1 6 0v5a3 3 0 0 1-.4 1.5" /><path d="M11.3 14a3 3 0 0 1-2.3-2.9V9.3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 10 5.5" /><path d="M18.4 13.6a6.5 6.5 0 0 0 .1-2.1" /><path d="M12 18v3" /><path d="m3.5 3.5 17 17" /></>,
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
