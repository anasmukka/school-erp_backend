import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Phone,
  PhoneCall,
  Mail,
  MessageCircle,
  Clock,
  MapPin,
  Save,
  CheckCircle2,
  AlertCircle,
  Eye,
  ShieldCheck,
  Info,
  ExternalLink,
  Loader2,
  RotateCcw,
} from "lucide-react";
import {
  SchoolContact,
  SchoolContactInput,
  getSchoolContact,
  saveSchoolContact,
  validateContactForm,
  formatPhoneForTel,
  formatWhatsAppUrl,
  formatEmailMailto,
  formatMapUrl,
} from "@/lib/schoolContact";
import { DEFAULT_SCHOOL_ID } from "@/lib/r2StorageKeys";

export default function ContactSettings() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"form" | "preview">("form");

  // Form state
  const [form, setForm] = useState<SchoolContactInput>({
    schoolId: DEFAULT_SCHOOL_ID,
    schoolName: "Prestige International School",
    email: "",
    phone: "",
    secondaryPhone: "",
    whatsapp: "",
    officeHours: "Monday – Friday: 8:00 AM – 3:30 PM\nSaturday: 8:00 AM – 12:30 PM",
    address: "",
    emergencyPhone: "",
    instructions: "For examination, attendance, and hall ticket inquiries, please include your student admission number in all communications.",
    mapUrl: "",
    published: true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedContact, setSavedContact] = useState<SchoolContact | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const data = await getSchoolContact(DEFAULT_SCHOOL_ID);
        if (data) {
          setSavedContact(data);
          setForm({
            schoolId: data.schoolId || DEFAULT_SCHOOL_ID,
            schoolName: data.schoolName || "Prestige International School",
            email: data.email || "",
            phone: data.phone || "",
            secondaryPhone: data.secondaryPhone || "",
            whatsapp: data.whatsapp || "",
            officeHours: data.officeHours || "",
            address: data.address || "",
            emergencyPhone: data.emergencyPhone || "",
            instructions: data.instructions || "",
            mapUrl: data.mapUrl || "",
            published: data.published ?? true,
          });
        }
      } catch (err: any) {
        toast({
          title: "Error loading contact settings",
          description: err?.message || "Could not retrieve existing records.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleChange = (field: keyof SchoolContactInput, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;

    // Validate form
    const validation = validateContactForm(form);
    if (!validation.valid) {
      setErrors(validation.errors);
      toast({
        title: "Validation errors detected",
        description: "Please fix the highlighted fields before publishing.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const updated = await saveSchoolContact(form, {
        uid: appUser.id,
        email: appUser.email || "admin@prestigeschool.edu",
        name: appUser.name || "Administrator",
      });

      setSavedContact(updated);
      setErrors({});
      toast({
        title: "School Contact Published",
        description: "The updated contact details are now live in the Student Panel.",
      });
    } catch (err: any) {
      toast({
        title: "Publish failed",
        description: err?.message || "Could not save contact configuration.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const resetToPublished = () => {
    if (!savedContact) return;
    setForm({
      schoolId: savedContact.schoolId,
      schoolName: savedContact.schoolName,
      email: savedContact.email,
      phone: savedContact.phone,
      secondaryPhone: savedContact.secondaryPhone || "",
      whatsapp: savedContact.whatsapp || "",
      officeHours: savedContact.officeHours,
      address: savedContact.address,
      emergencyPhone: savedContact.emergencyPhone || "",
      instructions: savedContact.instructions || "",
      mapUrl: savedContact.mapUrl || "",
      published: savedContact.published,
    });
    setErrors({});
    toast({
      title: "Form reset",
      description: "Restored to the currently published configuration.",
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              School Contact Directory Settings
            </h1>
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-xs">
              Student Directory
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the verified contact details displayed exclusively to students in their portal directory.
          </p>
        </div>

        {/* Last Updated Badge */}
        {savedContact?.updatedAt && (
          <div className="text-xs text-muted-foreground bg-muted/50 p-2.5 rounded-lg border flex flex-col sm:items-end">
            <span className="font-medium text-foreground">Last Published</span>
            <span className="font-mono text-[11px]">
              {new Date(savedContact.updatedAt).toLocaleString()}
            </span>
            <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
              by {savedContact.updatedByName || savedContact.updatedByEmail}
            </span>
          </div>
        )}
      </div>

      {/* Security Architecture Separation Notice */}
      <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-900 dark:text-blue-200 space-y-1">
          <p className="font-semibold text-blue-950 dark:text-blue-100">
            Security Isolation & Notification Provider Protection
          </p>
          <p>
            The contact details configured on this page are strictly for <strong>public student directory presentation</strong> and safe template footers.
            Modifying the displayed phone number or WhatsApp contact will <strong>never alter private notification secrets</strong> (such as Meta WhatsApp Cloud API credentials or SMTP server tokens).
          </p>
        </div>
      </div>

      {loading ? (
        <Card className="p-12 text-center border-dashed">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading contact configuration...</p>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-6">
          <div className="flex items-center justify-between border-b pb-2">
            <TabsList>
              <TabsTrigger value="form" className="gap-2">
                <Building2 size={16} />
                Edit Contact Details
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-2">
                <Eye size={16} />
                Student Panel Live Preview
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              {savedContact && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetToPublished}
                  disabled={saving}
                  className="gap-1.5 text-xs"
                >
                  <RotateCcw size={14} />
                  Reset
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handlePublish}
                disabled={saving}
                className="gap-1.5 shadow-sm"
              >
                {saving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Save size={14} />
                    Publish Changes
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* EDIT FORM TAB */}
          <TabsContent value="form" className="space-y-6 m-0">
            <form onSubmit={handlePublish} className="space-y-6">
              {/* Institution Identity */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base font-semibold">Institution Identity</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Official school name and authoritative contact inbox
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="schoolName" className="text-xs font-medium">
                      School Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="schoolName"
                      value={form.schoolName}
                      onChange={(e) => handleChange("schoolName", e.target.value)}
                      placeholder="Prestige International School"
                      className={errors.schoolName ? "border-destructive" : ""}
                    />
                    {errors.schoolName && (
                      <p className="text-xs text-destructive">{errors.schoolName}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-medium">
                      Official Contact Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => handleChange("email", e.target.value)}
                      placeholder="info@prestigeschool.edu"
                      className={errors.email ? "border-destructive" : ""}
                    />
                    {errors.email && (
                      <p className="text-xs text-destructive">{errors.email}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Public inquiry address. Clicking opens the student device's default mail client.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Telephone & Messaging Channels */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base font-semibold">Telephone & Instant Messaging</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Numbers must include country or STD code. Validated for 7–15 digits.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Primary Phone */}
                    <div className="space-y-1.5">
                      <Label htmlFor="phone" className="text-xs font-medium">
                        Primary School Phone <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="phone"
                        value={form.phone}
                        onChange={(e) => handleChange("phone", e.target.value)}
                        placeholder="+91 824 227 7777"
                        className={errors.phone ? "border-destructive" : ""}
                      />
                      {errors.phone && (
                        <p className="text-xs text-destructive">{errors.phone}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Main reception / administration telephone line.
                      </p>
                    </div>

                    {/* Secondary Phone (Optional) */}
                    <div className="space-y-1.5">
                      <Label htmlFor="secondaryPhone" className="text-xs font-medium">
                        Secondary Phone <span className="text-muted-foreground">(Optional)</span>
                      </Label>
                      <Input
                        id="secondaryPhone"
                        value={form.secondaryPhone}
                        onChange={(e) => handleChange("secondaryPhone", e.target.value)}
                        placeholder="+91 824 227 7778"
                        className={errors.secondaryPhone ? "border-destructive" : ""}
                      />
                      {errors.secondaryPhone && (
                        <p className="text-xs text-destructive">{errors.secondaryPhone}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Alternative administrative line. Hidden in student panel if empty.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    {/* Official WhatsApp */}
                    <div className="space-y-1.5">
                      <Label htmlFor="whatsapp" className="text-xs font-medium flex items-center gap-1.5">
                        <MessageCircle size={14} className="text-emerald-600" />
                        Official WhatsApp Support Number <span className="text-muted-foreground">(Optional)</span>
                      </Label>
                      <Input
                        id="whatsapp"
                        value={form.whatsapp}
                        onChange={(e) => handleChange("whatsapp", e.target.value)}
                        placeholder="+91 9876543210"
                        className={errors.whatsapp ? "border-destructive" : ""}
                      />
                      {errors.whatsapp && (
                        <p className="text-xs text-destructive">{errors.whatsapp}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Opens direct WhatsApp chat with prefilled student identifier prompt.
                      </p>
                    </div>

                    {/* Emergency Contact */}
                    <div className="space-y-1.5">
                      <Label htmlFor="emergencyPhone" className="text-xs font-medium flex items-center gap-1.5">
                        <AlertCircle size={14} className="text-amber-600" />
                        Emergency Helpline Number <span className="text-muted-foreground">(Optional)</span>
                      </Label>
                      <Input
                        id="emergencyPhone"
                        value={form.emergencyPhone}
                        onChange={(e) => handleChange("emergencyPhone", e.target.value)}
                        placeholder="+91 9876500000"
                        className={errors.emergencyPhone ? "border-destructive" : ""}
                      />
                      {errors.emergencyPhone && (
                        <p className="text-xs text-destructive">{errors.emergencyPhone}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Urgent student safety & transport helpline. Highlighted in amber.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Physical Location & Operational Hours */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base font-semibold">Campus Location & Office Timings</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="officeHours" className="text-xs font-medium">
                        School Office Hours <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id="officeHours"
                        rows={3}
                        value={form.officeHours}
                        onChange={(e) => handleChange("officeHours", e.target.value)}
                        placeholder="Monday – Friday: 8:00 AM – 3:30 PM&#10;Saturday: 8:00 AM – 12:30 PM"
                        className={errors.officeHours ? "border-destructive" : ""}
                      />
                      {errors.officeHours && (
                        <p className="text-xs text-destructive">{errors.officeHours}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="mapUrl" className="text-xs font-medium">
                        Google Maps Destination URL <span className="text-muted-foreground">(Optional)</span>
                      </Label>
                      <Input
                        id="mapUrl"
                        value={form.mapUrl}
                        onChange={(e) => handleChange("mapUrl", e.target.value)}
                        placeholder="https://maps.google.com/?q=..."
                        className={errors.mapUrl ? "border-destructive" : ""}
                      />
                      {errors.mapUrl && (
                        <p className="text-xs text-destructive">{errors.mapUrl}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Custom maps link. If omitted, Google Maps search uses the physical address below.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="address" className="text-xs font-medium">
                      Physical Campus Address <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="address"
                      rows={2}
                      value={form.address}
                      onChange={(e) => handleChange("address", e.target.value)}
                      placeholder="Prestige International School, Jeppinamogaru, Mangaluru, Karnataka 575009"
                      className={errors.address ? "border-destructive" : ""}
                    />
                    {errors.address && (
                      <p className="text-xs text-destructive">{errors.address}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Additional Contact Instructions */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base font-semibold">Student Contact Guidelines</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Optional instructions provided to students when reaching out
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    id="instructions"
                    rows={3}
                    value={form.instructions}
                    onChange={(e) => handleChange("instructions", e.target.value)}
                    placeholder="For examination, attendance, and hall ticket inquiries, please include your student admission number in all communications."
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Displayed in an advisory note box within the Student Panel.
                  </p>
                </CardContent>
              </Card>

              {/* Submit Button */}
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={saving} className="gap-2 px-6">
                  {saving ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Publishing to Student Directory...
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      Save & Publish School Contact
                    </>
                  )}
                </Button>
              </div>
            </form>
          </TabsContent>

          {/* STUDENT PANEL LIVE PREVIEW TAB */}
          <TabsContent value="preview" className="space-y-6 m-0">
            <div className="p-3 bg-muted/40 rounded-lg border text-xs text-muted-foreground flex items-center justify-between">
              <span>
                <strong>Live Simulation:</strong> This view renders exactly how the contact directory will appear to authenticated students.
              </span>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[11px]">
                Student View
              </Badge>
            </div>

            {/* Mocked Student Contact Interface with current form values */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
              <div className="md:col-span-2 space-y-6">
                <Card className="shadow-sm border-primary/10 overflow-hidden">
                  <CardHeader className="bg-primary/5 border-b pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                        <Building2 size={24} />
                      </div>
                      <div>
                        <CardTitle className="text-xl font-bold">
                          {form.schoolName || "School Name Preview"}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Official Institution Contact Profile
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-6 space-y-5">
                    {/* Official Email */}
                    <div className="flex items-start gap-3.5 p-3.5 rounded-lg bg-muted/40">
                      <div className="p-2 rounded-md bg-blue-500/10 text-blue-600 mt-0.5">
                        <Mail size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">Official Email Address</p>
                        <p className="text-base font-semibold text-primary break-all">
                          {form.email || "No email specified"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          For student queries, transcript requests, and general communication.
                        </p>
                      </div>
                    </div>

                    {/* Phones */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-3.5 rounded-lg bg-muted/40">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-600">
                            <Phone size={16} />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">Primary Phone</span>
                        </div>
                        <p className="text-base font-semibold text-foreground">
                          {form.phone || "No phone specified"}
                        </p>
                      </div>

                      {form.secondaryPhone && form.secondaryPhone.trim() ? (
                        <div className="p-3.5 rounded-lg bg-muted/40">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="p-1.5 rounded-md bg-indigo-500/10 text-indigo-600">
                              <PhoneCall size={16} />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">Secondary Line</span>
                          </div>
                          <p className="text-base font-semibold text-foreground">
                            {form.secondaryPhone}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    {/* WhatsApp */}
                    {form.whatsapp && form.whatsapp.trim() ? (
                      <div className="flex items-center justify-between p-3.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/50">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-emerald-500 text-white shadow-sm">
                            <MessageCircle size={18} />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                              Official School WhatsApp
                            </p>
                            <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                              {form.whatsapp}
                            </p>
                          </div>
                        </div>
                        <Button size="sm" className="bg-emerald-600 text-white" disabled>
                          Open Chat
                        </Button>
                      </div>
                    ) : null}

                    {/* Address */}
                    <div className="p-4 rounded-lg bg-muted/30 border space-y-3">
                      <div className="flex items-start gap-3">
                        <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Campus Location
                          </p>
                          <p className="text-sm text-foreground whitespace-pre-line mt-1 font-medium leading-relaxed">
                            {form.address || "No address configured yet."}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Instructions */}
                    {form.instructions && form.instructions.trim() ? (
                      <div className="p-4 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50">
                        <div className="flex items-start gap-2.5">
                          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold text-blue-900 dark:text-blue-300">
                              Student Contact Guidelines
                            </p>
                            <p className="text-sm text-blue-950 dark:text-blue-200 whitespace-pre-line mt-1">
                              {form.instructions}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>

              {/* Right Col Preview */}
              <div className="space-y-6">
                <Card className="shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      <CardTitle className="text-base font-semibold">Office Hours</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="p-3.5 rounded-lg bg-muted/40">
                      <p className="text-sm font-medium text-foreground whitespace-pre-line leading-relaxed">
                        {form.officeHours || "Not specified."}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {form.emergencyPhone && form.emergencyPhone.trim() ? (
                  <Card className="border-amber-300/60 bg-amber-50/40 shadow-sm">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2 text-amber-800">
                        <AlertCircle className="h-4 w-4" />
                        <CardTitle className="text-base font-semibold">Emergency Helpline</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="p-3 rounded-lg bg-amber-500/10 text-amber-900 font-bold text-lg text-center">
                        {form.emergencyPhone}
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
