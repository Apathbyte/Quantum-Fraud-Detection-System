import { cn } from '@/lib/utils'

type FooterProps = React.ComponentProps<'footer'>

export function Footer({ className, ...props }: FooterProps) {
  return (
    <footer
      className={cn(
        'text-muted-foreground mt-auto shrink-0 border-t px-4 py-4 text-center text-sm',
        className
      )}
      {...props}
    >
      <span>&copy; {new Date().getFullYear()} All rights reserved by <a href="https://github.com/Apathbyte" target="_blank" rel="noreferrer" className="text-foreground font-medium underline-offset-4 hover:underline">Team Mandalorians</a> </span>
      <span>
         &bull; Made For ThunderHacks 2026{' '}
        <a
          href='https://thunderhacks.algomau.ca/'
          target='_blank'
          rel='noreferrer'
          className='text-foreground font-medium underline-offset-4 hover:underline'
        >
          ThunderHacks
        </a>
      </span>
    </footer>
  )
}
