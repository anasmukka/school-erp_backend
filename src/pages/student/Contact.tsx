import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Mail,
  Phone,
  PhoneCall,
  MessageCircle,
  Clock,
  MapPin,
  AlertCircle,
  ExternalLink,
  Info,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import {
  SchoolContact,
  getSchoolContact,
  formatPhoneForTel,
  formatWhatsAppUrl,
  formatEmailMailto,
  formatMapUrl,
} from "@/lib/schoolContact";
import { DEFAULT_SCHOOL_ID } from "@/lib/r2StorageKeys";

export default function StudentContact() {
  const [contact, setContact] = useState<SchoolContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadContact() {
      setLoading(true);
      setError(null);
      try {
        const data = await getSchoolContact(DEFAULT_SCHOOL_ID);
        setContact(data);
      } catch (err: any) {
        setError(err?.message || "Failed to load school contact information.");
      } finally {
        setLoading(false);
      }
    }
    loadContact();
  }, []);

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-4 py-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Official School Contact
            </h1>
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-xs">
              Student Directory
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Direct communication channels for Prestige International School administration, academic departments, and support services.
          </p>
        </div>
      </div>

      {loading ? (
        <Card className="p-12 text-center border-dashed">
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">
              Retrieving verified school contact details...
            </p>
          </div>
        </Card>
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/5 p-6 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-2" />
          <h3 className="font-semibold text-destructive">Unable to Load Contact Information</h3>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Retry Connection
          </Button>
        </Card>
      ) : !contact || !contact.published ? (
        /* Clean Unconfigured State - No fake data or placeholder numbers */
        <Card className="border-dashed p-10 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/60 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground">Contact Directory Updating</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
            The school administration is currently updating official contact records.
            Please visit the administration office during standard operational hours or check back shortly.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Institution Card (Left / 2 Cols) */}
          <div className="md:col-span-2 space-y-6">
            <Card className="shadow-sm border-primary/10 overflow-hidden">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                    <Building2 size={24} />
                  </div>
                  <div>
                    <CardTitle className="text-xl font-bold">{contact.schoolName}</CardTitle>
                    <CardDescription className="text-xs">
                      Official Institution Contact Profile
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-6 space-y-5">
                {/* Official Email */}
                <div className="flex items-start gap-3.5 p-3.5 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                  <div className="p-2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 mt-0.5">
                    <Mail size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Official Email Address</p>
                    <a
                      href={formatEmailMailto(contact.email)}
                      className="text-base font-semibold text-primary hover:underline break-all inline-flex items-center gap-1.5"
                    >
                      {contact.email}
                      <ExternalLink size={13} className="shrink-0 opacity-70" />
                    </a>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      For student queries, transcript requests, and general communication.
                    </p>
                  </div>
                </div>

                {/* Primary & Secondary Phone */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Primary Phone */}
                  <div className="p-3.5 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <Phone size={16} />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">Primary Phone</span>
                    </div>
                    <a
                      href={formatPhoneForTel(contact.phone)}
                      className="text-base font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                    >
                      {contact.phone}
                      <ExternalLink size={12} className="opacity-60" />
                    </a>
                  </div>

                  {/* Secondary Phone (Optional - Rendered ONLY if configured) */}
                  {contact.secondaryPhone && contact.secondaryPhone.trim() ? (
                    <div className="p-3.5 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="p-1.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                          <PhoneCall size={16} />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">Secondary Line</span>
                      </div>
                      <a
                        href={formatPhoneForTel(contact.secondaryPhone)}
                        className="text-base font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                      >
                        {contact.secondaryPhone}
                        <ExternalLink size={12} className="opacity-60" />
                      </a>
                    </div>
                  ) : null}
                </div>

                {/* WhatsApp Official Contact (Optional - Rendered ONLY if configured) */}
                {contact.whatsapp && contact.whatsapp.trim() ? (
                  <div className="flex items-center justify-between p-3.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/40">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-emerald-500 text-white shadow-sm">
                        <MessageCircle size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                          Official School WhatsApp
                        </p>
                        <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                          {contact.whatsapp}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                      asChild
                    >
                      <a
                        href={formatWhatsAppUrl(contact.whatsapp, "Hello, I am a student at Prestige International School inquiry.")}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Chat
                      </a>
                    </Button>
                  </div>
                ) : null}

                {/* Physical Address & Map */}
                <div className="p-4 rounded-lg bg-muted/30 border space-y-3">
                  <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Campus Location
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-line mt-1 font-medium leading-relaxed">
                        {contact.address}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      asChild
                    >
                      <a
                        href={formatMapUrl(contact.address, contact.mapUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MapPin size={14} className="text-primary" />
                        View on Google Maps
                        <ExternalLink size={12} className="opacity-70" />
                      </a>
                    </Button>
                  </div>
                </div>

                {/* Additional Instructions (Optional - Rendered ONLY if configured) */}
                {contact.instructions && contact.instructions.trim() ? (
                  <div className="p-4 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-900/50">
                    <div className="flex items-start gap-2.5">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-blue-900 dark:text-blue-300">
                          Student Contact Guidelines
                        </p>
                        <p className="text-sm text-blue-950 dark:text-blue-200 whitespace-pre-line mt-1">
                          {contact.instructions}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Operational Hours & Emergency Details (Right Col) */}
          <div className="space-y-6">
            {/* Office Hours */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base font-semibold">Office Hours</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Campus visiting and telephone desk timings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="p-3.5 rounded-lg bg-muted/40">
                  <p className="text-sm font-medium text-foreground whitespace-pre-line leading-relaxed">
                    {contact.officeHours}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Emergency Contact (Optional - Rendered ONLY if configured) */}
            {contact.emergencyPhone && contact.emergencyPhone.trim() ? (
              <Card className="border-amber-300/60 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/20 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                    <ShieldAlert className="h-4 w-4" />
                    <CardTitle className="text-base font-semibold">Emergency Helpline</CardTitle>
                  </div>
                  <CardDescription className="text-xs text-amber-700/80 dark:text-amber-400/80">
                    For urgent medical, transport, or safety alerts
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <a
                    href={formatPhoneForTel(contact.emergencyPhone)}
                    className="block p-3 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 font-bold text-lg text-center transition-colors"
                  >
                    {contact.emergencyPhone}
                  </a>
                  <p className="text-xs text-center text-muted-foreground">
                    Available during campus operational hours & field trips.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {/* Verification Status */}
            <Card className="bg-muted/20 border-dashed">
              <CardContent className="pt-5 pb-5 text-xs text-muted-foreground space-y-1.5">
                <div className="flex items-center justify-between">
                  <span>Verification:</span>
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    Official Administration
                  </Badge>
                </div>
                {contact.updatedAt ? (
                  <div className="flex items-center justify-between pt-1">
                    <span>Published:</span>
                    <span className="font-mono text-[11px]">
                      {new Date(contact.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
