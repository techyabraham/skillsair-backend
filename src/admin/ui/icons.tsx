/**
 * One icon per collection, global and custom view (brief 5.4), used in the nav, page titles
 * and empty states. Lucide, named imports only, 1.75 stroke. Server-safe: the nav renders
 * these on the server and passes the elements to its client part, so Lucide stays out of
 * the client bundle there.
 */
import React from 'react'
import {
  Activity,
  Award,
  BookOpen,
  CalendarPlus,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Handshake,
  HelpCircle,
  Image,
  Inbox,
  Laptop,
  LayoutDashboard,
  ListChecks,
  ListTree,
  Mail,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  PenLine,
  PlayCircle,
  Receipt,
  Repeat,
  School,
  Share2,
  Star,
  Tags,
  Timer,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export const ENTITY_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  queue: MessageCircle,
  lifecycle: Workflow,
  leads: Inbox,
  'scholarship-window': Timer,
  orders: Receipt,
  subscriptions: Repeat,
  plans: Tags,
  courses: BookOpen,
  sections: ListTree,
  lessons: PlayCircle,
  quizzes: ListChecks,
  'quiz-questions': HelpCircle,
  certificates: Award,
  users: Users,
  enrollments: GraduationCap,
  'lesson-progress': Activity,
  'quiz-attempts': ClipboardCheck,
  'laptop-applications': Laptop,
  reviews: Star,
  discussions: MessagesSquare,
  messages: Mail,
  'email-content': PenLine,
  'newsletter-subscribers': Newspaper,
  pages: FileText,
  posts: Newspaper,
  media: Image,
  categories: School,
  affiliates: Handshake,
  referrals: Share2,
  'access-extensions': CalendarPlus,
}

export function EntityIcon({ slug, size = 20, className }: { slug: string; size?: number; className?: string }) {
  const Icon = ENTITY_ICONS[slug] ?? LayoutDashboard
  return <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={1.75} className={className} />
}
