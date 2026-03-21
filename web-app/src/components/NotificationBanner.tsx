interface NotificationBannerProps {
  count: number
}

export function NotificationBanner({ count }: NotificationBannerProps) {
  if (count <= 0) return null

  return (
    <div className="alert alert-warning" style={{ maxWidth: 480, width: '100%', marginTop: 10, textAlign: 'center' }}>
      {count} more pending request{count > 1 ? 's' : ''} in queue
    </div>
  )
}
