import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Click the button below to accept the invitation and create your
          account.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept Invitation
        </Button>

        <Hr style={hr} />
        <Heading as="h2" style={h2}>
          📱 Add {siteName} to your iPhone home screen
        </Heading>
        <Text style={text}>
          For the best experience, install {siteName} as an app on your phone.
          On iPhone, this also unlocks push notifications for game invites and
          RSVPs.
        </Text>
        <Section style={steps}>
          <Text style={step}><strong>1.</strong> Open the invitation link above in <strong>Safari</strong> (not Chrome or in-app browsers).</Text>
          <Text style={step}><strong>2.</strong> Tap the <strong>Share</strong> button (the square with an up arrow) in the bottom toolbar.</Text>
          <Text style={step}><strong>3.</strong> Scroll down and tap <strong>Add to Home Screen</strong>.</Text>
          <Text style={step}><strong>4.</strong> Tap <strong>Add</strong> in the top right. The {siteName} icon now sits on your home screen.</Text>
        </Section>

        <Heading as="h2" style={h2}>
          🔔 Turn on push notifications
        </Heading>
        <Text style={text}>
          Push notifications on iPhone only work from the home‑screen app — not
          from Safari. Once installed:
        </Text>
        <Section style={steps}>
          <Text style={step}><strong>1.</strong> Open {siteName} from your home screen icon and sign in.</Text>
          <Text style={step}><strong>2.</strong> Go to <strong>Profile → Notifications</strong> and tap <strong>Enable push notifications</strong>.</Text>
          <Text style={step}><strong>3.</strong> When iOS asks, tap <strong>Allow</strong>. You'll get a test ping to confirm it's working.</Text>
        </Section>
        <Text style={tip}>
          On Android, the browser will offer an "Install app" prompt — accept
          it, then enable notifications from Profile the same way.
        </Text>

        <Hr style={hr} />
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this
          email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const link = { color: 'inherit', textDecoration: 'underline' }
const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
const h2 = {
  fontSize: '16px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '24px 0 10px',
}
const hr = { borderColor: '#e6e6e6', margin: '30px 0 10px' }
const steps = { margin: '0 0 10px' }
const step = {
  fontSize: '14px',
  fontWeight: 'bold' as const,
  color: '#000000',
  lineHeight: '1.5',
  margin: '0 0 8px',
}
const tip = {
  fontSize: '13px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '12px 0 0',
  fontStyle: 'italic' as const,
}
