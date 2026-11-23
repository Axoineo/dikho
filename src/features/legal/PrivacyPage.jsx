import { useEffect } from 'react'

/* Privacy notice and terms of use for the public forms and the CRM (pre-launch audit
 * 12.1). Written to India's Digital Personal Data Protection Act, 2023: what is
 * collected, why, who processes it, how long it is kept, people's rights and whom
 * to contact. A DRAFT for the owner to review before relying on it; not legal advice. */
const UPDATED = '23 November 2026'
const CONTACT = 'inquiry@dikho.in'

export default function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacy and terms · Dikho'
  }, [])

  return (
    <main className="legal-page">
      <article className="legal-doc">
        <img src="/dikho-logo.svg" alt="Dikho" className="legal-logo" />
        <h1>Privacy and terms</h1>
        <p className="legal-updated">Last updated {UPDATED}</p>

        <p>
          This notice explains how Dikho Global Media LLP (&ldquo;Dikho&rdquo;, &ldquo;we&rdquo;), Ahmedabad, Gujarat,
          India, handles personal data you give us through our website forms, by WhatsApp or email, and in the course of
          doing business with us.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Enquiries</strong> (corporate gifting form): your name, company, phone number, email, city and what you are looking for.</li>
          <li><strong>Vendor registration</strong>: company and contact details, address, GSTIN and PAN, bank details for payments, and any document you upload.</li>
          <li><strong>Messages</strong>: what you send us on WhatsApp or by email, including photos, voice notes and files.</li>
          <li><strong>Clients and orders</strong>: contact and tax details needed for quotations, orders and GST invoices.</li>
          <li><strong>Staff using the CRM</strong>: name, work email or phone number, sign-in times, device and approximate location of each sign-in.</li>
        </ul>

        <h2>Why we use it</h2>
        <p>
          To answer your enquiry, register and pay vendors, carry out orders, issue invoices, keep the records Indian tax
          law requires, keep the service secure, and, if you agreed to it, send you updates. We send marketing messages
          only to people who agreed to receive them; reply STOP on WhatsApp or use the unsubscribe link in an email to stop
          them at any time.
        </p>

        <h2>Who processes it for us</h2>
        <p>
          Our service providers, only to run the service: Supabase (database and file storage), Cloudflare (hosting and
          bot protection), Meta (WhatsApp messages), Brevo and Google (email), and the Government of India&rsquo;s API Setu
          (to look up a GSTIN you enter). We do not sell personal data.
        </p>

        <h2>How long we keep it</h2>
        <p>
          For as long as we work together, then as long as the law requires: tax and invoice records for the period GST and
          income-tax law set. Enquiries that do not lead to business, and messages, are deleted when no longer needed.
        </p>

        <h2>Your rights</h2>
        <p>
          You can ask to see the personal data we hold about you, to correct it, or to have it erased where the law does not
          require us to keep it, and you can withdraw consent you gave. You can also nominate someone to act for you. Write to
          us and we will answer within 30 days. If you are not satisfied, you may complain to the Data Protection Board of
          India.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy questions, requests or complaints: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <h2>Terms of use</h2>
        <ul>
          <li>Use our forms only to send true information about yourself or a business you represent.</li>
          <li>Submitting a form does not create an order, a contract or a vendor relationship; we confirm those separately in writing.</li>
          <li>Do not try to break, overload or get around the security of this site. The staff CRM is for authorised Dikho staff only.</li>
          <li>The site is provided as it is; we are not liable for losses from its use, except where the law says we must be.</li>
          <li>These terms are governed by the laws of India, and the courts at Ahmedabad have jurisdiction.</li>
        </ul>
      </article>
    </main>
  )
}
