import React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  hostName?: string
  title: string
  whenText: string
  location?: string | null
  buyIn?: string | null
  rsvpUrl: string
  recipientName?: string
}

const NightInvite = ({ hostName, title, whenText, location, buyIn, rsvpUrl, recipientName }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You're invited to {title}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>♠ You're invited</Heading>
        <Text style={paragraph}>
          {recipientName ? `Hi ${recipientName},` : 'Hi there,'}
        </Text>
        <Text style={paragraph}>
          {hostName ? `${hostName} is` : "You're"} hosting a poker game — a seat's waiting for you.
        </Text>

        <Section style={card}>
          <Text style={cardTitle}>{title}</Text>
          <Text style={cardRow}><strong>When:</strong> {whenText}</Text>
          {location ? <Text style={cardRow}><strong>Where:</strong> {location}</Text> : null}
          {buyIn ? <Text style={cardRow}><strong>Buy-in:</strong> {buyIn}</Text> : null}
        </Section>

        <Section style={{ textAlign: 'center', marginTop: '28px' }}>
          <Button href={rsvpUrl} style={button}>RSVP now</Button>
        </Section>

        <Hr style={hr} />
        <Text style={footer}>
          If the button doesn't work, open this link:<br />
          <a href={rsvpUrl} style={link}>{rsvpUrl}</a>
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: NightInvite,
  subject: (data: Record<string, any>) => `You're invited: ${data.title ?? 'Poker Club'}`,
  displayName: 'Poker Club Invite',
  previewData: {
    hostName: 'Marco',
    title: 'Friday Poker Club',
    whenText: 'Fri, Jul 10, 20:00',
    location: "Marco's place",
    buyIn: '€50',
    rsvpUrl: 'https://example.com/nights/123',
    recipientName: 'Alex',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif', color: '#0f172a' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 24px' }
const h1 = { fontFamily: '"Playfair Display", Georgia, serif', fontSize: '28px', margin: '0 0 16px', color: '#0f172a' }
const paragraph = { fontSize: '15px', lineHeight: '22px', color: '#334155', margin: '0 0 12px' }
const card = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginTop: '20px' }
const cardTitle = { fontFamily: '"Playfair Display", Georgia, serif', fontSize: '20px', margin: '0 0 12px', color: '#0f172a' }
const cardRow = { fontSize: '14px', color: '#334155', margin: '4px 0' }
const button = { background: '#b8860b', color: '#ffffff', padding: '12px 28px', borderRadius: '8px', fontSize: '15px', fontWeight: 600, textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#e2e8f0', margin: '28px 0 16px' }
const footer = { fontSize: '12px', color: '#94a3b8', lineHeight: '18px', textAlign: 'center' as const }
const link = { color: '#b8860b', wordBreak: 'break-all' as const }