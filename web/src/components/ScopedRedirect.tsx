import { Navigate, useLocation } from 'react-router'
import { useProfileScope } from '@/contexts/useProfileScope'

/**
 * Redirect that keeps the management scope (`?profile=`) and does not race
 * ProfileProvider's URL sync.
 *
 * ProfileProvider stamps `?profile=` onto a profile-less URL in an effect
 * that runs after its children's effects. A plain `<Navigate>` fired in the
 * same commit (opening `/` with no `?profile=`) is then overwritten by that
 * stamp, which still holds the pre-redirect path. The URL goes back to
 * `/?profile=X`, the redirect element stays mounted without firing again,
 * and the page renders empty. Waiting one commit for the stamp, then
 * redirecting with the search string, lets the provider see a URL already in
 * sync, so nothing overwrites the redirect.
 */
export function ScopedRedirect({ to }: { to: string }) {
  const { search } = useLocation()
  const { profile } = useProfileScope()
  const urlProfile = new URLSearchParams(search).get('profile')
  if ((profile || '') !== (urlProfile ?? '')) {
    return null
  }
  return <Navigate to={{ pathname: to, search }} replace />
}
