import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import type { Subject } from "@/lib/types";
import {
  AcademicStructure,
  AcademicStructureVersion,
  AcademicTermConfig,
  DefinedExam,
  AssessmentComponent,
  GradingScale,
  CoScholasticArea,
  ReportCardSectionConfig,
  CalculationConfiguration,
  CalculationMethod,
  ScholasticTableConfig,
  CoScholasticSectionConfig,
  CoScholasticAreaEntry,
  DiscreteGradingScale,
  SubjectAssessmentOverride,
  StructureSubjectEntry,
  DEFAULT_CBSE_GRADING_SCALE,
  DEFAULT_PRIMARY_COMPONENTS,
  DEFAULT_PRIMARY_EXAMS,
  DEFAULT_TERMS,
  DEFAULT_CO_SCHOLASTIC,
  DEFAULT_REPORT_CARD_LAYOUT,
  DEFAULT_DISCRETE_GRADING_SCALES,
  DEFAULT_SCHOLASTIC_TABLE_CONFIG,
  DEFAULT_CO_SCHOLASTIC_CONFIG,
  listAcademicStructures,
  createAcademicStructure,
  updateAcademicStructure,
  activateAcademicStructure,
  archiveAcademicStructure,
  duplicateAcademicStructure,
  getStructureVersion,
  getEffectiveComponentsForSubject,
  deriveTermMaxMarks,
  normalizeScholasticTableConfig,
  normalizeCoScholasticConfig,
} from "@/lib/academicStructure";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Layers,
  BookOpen,
  CalendarDays,
  FileSpreadsheet,
  Award,
  FileText,
  Eye,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  Archive,
  AlertTriangle,
  History,
  Save,
  ArrowUpDown,
  Printer,
  ChevronRight,
  Shield,
  Clock,
  Sparkles,
  School,
  ArrowUp,
  ArrowDown,
  Edit2,
  SlidersHorizontal,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

const ALL_GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

export default function AcademicStructurePlanner() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  const [structures, setStructures] = useState<AcademicStructure[]>([]);
  const [selectedStructureId, setSelectedStructureId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Active loaded version state
  const [currentVersion, setCurrentVersion] = useState<AcademicStructureVersion | null>(null);

  // Canonical central subjects
  const [centralSubjects, setCentralSubjects] = useState<Subject[]>([]);

  // Structure Form state
  const [structureName, setStructureName] = useState("");
  const [structureDesc, setStructureDesc] = useState("");
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [terms, setTerms] = useState<AcademicTermConfig[]>(DEFAULT_TERMS);
  const [activeTermSubTab, setActiveTermSubTab] = useState<string>("term_1");
  const [calcConfig, setCalcConfig] = useState<CalculationConfiguration>({
    roundingRule: "round_nearest",
    decimalPlaces: 1,
    termAggregation: "weighted_average",
    termWeights: { term_1: 50, term_2: 50 },
    institutionalPassingRules: {
      minScholasticPercentage: 33,
      minAttendancePercentage: 75,
      compartmentAllowed: true,
      maxCompartmentSubjects: 2,
    },
  });
  const [previewPeriod, setPreviewPeriod] = useState<"term_1" | "term_2" | "annual">("annual");
  const [previewGrade, setPreviewGrade] = useState<string>("");

  const activePreviewGrade = useMemo(() => {
    if (previewGrade && selectedGrades.includes(previewGrade)) return previewGrade;
    return selectedGrades[0] || "1";
  }, [previewGrade, selectedGrades]);

  // Central subjects applicable to the selected structure's grades
  const applicableCentralSubjects = useMemo(() => {
    return centralSubjects
      .filter((s) => selectedGrades.includes(s.grade))
      .sort((a, b) => {
        if (a.grade !== b.grade) return Number(a.grade) - Number(b.grade);
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }, [centralSubjects, selectedGrades]);

  // Grouped by grade for easy rendering in tabs
  const subjectsByGrade = useMemo(() => {
    const map: Record<string, Subject[]> = {};
    selectedGrades.forEach((g) => {
      map[g] = centralSubjects
        .filter((s) => s.grade === g)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    });
    return map;
  }, [centralSubjects, selectedGrades]);

  // Scholastic subjects for the currently selected preview grade
  const previewScholasticSubjects = useMemo(() => {
    return centralSubjects
      .filter((s) => s.grade === activePreviewGrade && (s.category || "scholastic") === "scholastic")
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [centralSubjects, activePreviewGrade]);

  const previewSubjectsNames = useMemo(() => {
    if (previewScholasticSubjects.length > 0) {
      return previewScholasticSubjects.map((s) => s.name);
    }
    return ["English", "Mathematics", "Science", "Social Science", "Hindi"];
  }, [previewScholasticSubjects]);
  const [exams, setExams] = useState<DefinedExam[]>([]);
  const [components, setComponents] = useState<AssessmentComponent[]>(DEFAULT_PRIMARY_COMPONENTS);
  const [gradingScale, setGradingScale] = useState<GradingScale>(DEFAULT_CBSE_GRADING_SCALE);
  const [coScholastic, setCoScholastic] = useState<CoScholasticArea[]>(DEFAULT_CO_SCHOLASTIC);
  const [scholasticTableConfig, setScholasticTableConfig] = useState<ScholasticTableConfig>(DEFAULT_SCHOLASTIC_TABLE_CONFIG);
  const [coScholasticConfig, setCoScholasticConfig] = useState<CoScholasticSectionConfig>(DEFAULT_CO_SCHOLASTIC_CONFIG);
  const [subjectOverrides, setSubjectOverrides] = useState<Record<string, SubjectAssessmentOverride>>({});
  const [discreteScales, setDiscreteScales] = useState<DiscreteGradingScale[]>(DEFAULT_DISCRETE_GRADING_SCALES);
  const [activeScholasticSubTab, setActiveScholasticSubTab] = useState<"term_1" | "term_2" | "overrides" | "overall">("term_1");
  const [selectedOverrideSubjId, setSelectedOverrideSubjId] = useState<string>("");

  // Component Dialog
  const [compDialogOpen, setCompDialogOpen] = useState(false);
  const [editingCompId, setEditingCompId] = useState<string | null>(null);
  const [compFormTermId, setCompFormTermId] = useState<"term_1" | "term_2">("term_1");
  const [compFormData, setCompFormData] = useState({
    name: "Periodic Test",
    code: "PT",
    maxMarks: 10,
    testedMaxMarks: 40,
    scalingTargetMarks: 10,
    calculationMethod: "raw" as CalculationMethod,
    contributeToTotal: true,
    displayOnReportCard: true,
    applicableExamId: "",
  });

  // Area Dialog
  const [areaDialogOpen, setAreaDialogOpen] = useState(false);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [areaFormData, setAreaFormData] = useState({
    name: "Work Education",
    code: "WE",
    category: "co-scholastic" as "co-scholastic" | "discipline" | "life-skills",
    applicableTermIds: ["term_1", "term_2"],
  });

  const [rcSections, setRcSections] = useState<ReportCardSectionConfig[]>(
    DEFAULT_REPORT_CARD_LAYOUT.sections
  );
  const [schoolHeader, setSchoolHeader] = useState({
    name: DEFAULT_REPORT_CARD_LAYOUT.schoolName,
    affiliation: DEFAULT_REPORT_CARD_LAYOUT.affiliationNo,
    address: DEFAULT_REPORT_CARD_LAYOUT.schoolAddress,
    tagline: DEFAULT_REPORT_CARD_LAYOUT.tagline,
  });

  // Modal dialogs
  const [newStructureModal, setNewStructureModal] = useState(false);
  const [newStructName, setNewStructName] = useState("");
  const [newStructDesc, setNewStructDesc] = useState("");
  const [newStructPreset, setNewStructPreset] = useState("primary");
  const [newStructGrades, setNewStructGrades] = useState<string[]>(["1", "2", "3", "4", "5"]);

  const [versionBumpModal, setVersionBumpModal] = useState(false);
  const [versionBumpNotes, setVersionBumpNotes] = useState("");

  const [duplicateModal, setDuplicateModal] = useState(false);
  const [duplicateName, setDuplicateName] = useState("");

  // Load structures & central subjects
  const reloadData = async () => {
    try {
      setLoading(true);
      const [structList, subjSnap] = await Promise.all([
        listAcademicStructures(effectiveSessionId || undefined),
        getDocs(collection(db, "subjects")),
      ]);

      const subjs = subjSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Subject));
      setCentralSubjects(subjs);
      setStructures(structList);

      if (structList.length > 0) {
        const toSelect = structList.find((s) => s.id === selectedStructureId) || structList[0];
        setSelectedStructureId(toSelect.id);
        await loadStructureDetails(toSelect);
      } else {
        setSelectedStructureId("");
        setCurrentVersion(null);
      }
    } catch (err) {
      console.error("Error loading academic structures:", err);
      toast({ title: "Error", description: "Failed to load academic structures", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();
  }, [effectiveSessionId]);

  const loadStructureDetails = async (struct: AcademicStructure) => {
    setStructureName(struct.name);
    setStructureDesc(struct.description || "");
    setSelectedGrades(struct.applicableGrades || []);

    const verDoc = await getStructureVersion(struct.id, struct.currentVersion || 1);
    if (verDoc) {
      setCurrentVersion(verDoc);
      setTerms(verDoc.terms && verDoc.terms.length > 0 ? verDoc.terms : DEFAULT_TERMS);
      setExams(verDoc.exams || DEFAULT_PRIMARY_EXAMS);
      setComponents(verDoc.assessmentComponents || DEFAULT_PRIMARY_COMPONENTS);
      setGradingScale(verDoc.gradingScale || DEFAULT_CBSE_GRADING_SCALE);
      if (verDoc.calculationConfig) {
        setCalcConfig(verDoc.calculationConfig);
      } else {
        setCalcConfig({
          roundingRule: "round_nearest",
          decimalPlaces: 1,
          termAggregation: "weighted_average",
          termWeights: { term_1: 50, term_2: 50 },
          institutionalPassingRules: {
            minScholasticPercentage: 33,
            minAttendancePercentage: 75,
            compartmentAllowed: true,
            maxCompartmentSubjects: 2,
          },
        });
      }
      setCoScholastic(verDoc.coScholasticAreas || DEFAULT_CO_SCHOLASTIC);
      setScholasticTableConfig(normalizeScholasticTableConfig(verDoc.scholasticTableConfig));
      setCoScholasticConfig(normalizeCoScholasticConfig(verDoc.coScholasticConfig));
      setSubjectOverrides(verDoc.subjectOverrides || {});
      setDiscreteScales(verDoc.discreteGradingScales && verDoc.discreteGradingScales.length > 0 ? verDoc.discreteGradingScales : DEFAULT_DISCRETE_GRADING_SCALES);
      setRcSections(verDoc.reportCardLayout?.sections || DEFAULT_REPORT_CARD_LAYOUT.sections);
      if (verDoc.reportCardLayout) {
        setSchoolHeader({
          name: verDoc.reportCardLayout.schoolName || DEFAULT_REPORT_CARD_LAYOUT.schoolName,
          affiliation: verDoc.reportCardLayout.affiliationNo || DEFAULT_REPORT_CARD_LAYOUT.affiliationNo,
          address: verDoc.reportCardLayout.schoolAddress || DEFAULT_REPORT_CARD_LAYOUT.schoolAddress,
          tagline: verDoc.reportCardLayout.tagline || DEFAULT_REPORT_CARD_LAYOUT.tagline,
        });
      }
    } else {
      setTerms(DEFAULT_TERMS);
      setExams(DEFAULT_PRIMARY_EXAMS);
      setComponents(DEFAULT_PRIMARY_COMPONENTS);
      setGradingScale(DEFAULT_CBSE_GRADING_SCALE);
      setScholasticTableConfig(DEFAULT_SCHOLASTIC_TABLE_CONFIG);
      setCoScholasticConfig(DEFAULT_CO_SCHOLASTIC_CONFIG);
      setSubjectOverrides({});
      setDiscreteScales(DEFAULT_DISCRETE_GRADING_SCALES);
    }
  };

  const handleSelectStructure = async (id: string) => {
    setSelectedStructureId(id);
    const found = structures.find((s) => s.id === id);
    if (found) await loadStructureDetails(found);
  };

  const activeStructure = useMemo(() => {
    return structures.find((s) => s.id === selectedStructureId) || null;
  }, [structures, selectedStructureId]);

  // Save changes handler
  const handleSaveStructure = async (bumpVersion = false, notes = "") => {
    if (!activeStructure || !appUser) return;
    try {
      setSaving(true);

      const subjectsConfig: StructureSubjectEntry[] = centralSubjects
        .filter((sub) => selectedGrades.includes(sub.grade))
        .sort((a, b) => {
          if (a.grade !== b.grade) return Number(a.grade) - Number(b.grade);
          return (a.order ?? 0) - (b.order ?? 0);
        })
        .map((sub, idx) => ({
          subjectId: sub.id,
          subjectName: sub.name,
          category: (sub.category || "scholastic") as "scholastic" | "co-scholastic",
          order: sub.order ?? idx + 1,
          grade: sub.grade,
          enabledOnReportCard: true,
        }));

      // Dynamically derive max marks for each term in scholastic table config
      const updatedScholasticConfig: ScholasticTableConfig = normalizeScholasticTableConfig({
        ...scholasticTableConfig,
        terms: (scholasticTableConfig.terms || []).map((t) => ({
          ...t,
          maxMarks: deriveTermMaxMarks(t),
        })),
      });

      const updatedCoScholasticConfig: CoScholasticSectionConfig = normalizeCoScholasticConfig(coScholasticConfig);

      // Flatten components for backwards-compatibility
      const flatComponents: AssessmentComponent[] = [
        ...(updatedScholasticConfig.terms[0]?.assessmentComponents || []),
        ...(updatedScholasticConfig.terms[1]?.assessmentComponents || []),
      ];

      const res = await updateAcademicStructure({
        structureId: activeStructure.id,
        name: structureName,
        description: structureDesc,
        applicableGrades: selectedGrades,
        subjects: subjectsConfig,
        terms,
        exams,
        assessmentComponents: flatComponents.length > 0 ? flatComponents : components,
        gradingScale,
        calculationConfig: calcConfig,
        coScholasticAreas: coScholastic,
        scholasticTableConfig: updatedScholasticConfig,
        coScholasticConfig: updatedCoScholasticConfig,
        subjectOverrides,
        discreteGradingScales: discreteScales,
        reportCardLayout: {
          schoolName: schoolHeader.name || DEFAULT_REPORT_CARD_LAYOUT.schoolName,
          affiliationNo: schoolHeader.affiliation || DEFAULT_REPORT_CARD_LAYOUT.affiliationNo,
          schoolAddress: schoolHeader.address || DEFAULT_REPORT_CARD_LAYOUT.schoolAddress,
          tagline: schoolHeader.tagline || DEFAULT_REPORT_CARD_LAYOUT.tagline,
          showSchoolLogo: true,
          showBoardLogo: true,
          gradingScalePlacement: "back_page",
          signatureSlots: DEFAULT_REPORT_CARD_LAYOUT.signatureSlots,
          sections: rcSections || DEFAULT_REPORT_CARD_LAYOUT.sections,
        },
        bumpVersion,
        versionNotes: notes,
        user: { uid: appUser.id, name: appUser.name, email: appUser.email },
      });

      toast({
        title: bumpVersion ? `New Version Created (v${res.versionNumber})` : "Structure Saved",
        description: `Academic Structure "${structureName}" has been successfully saved.`,
      });

      await reloadData();
    } catch (err: any) {
      console.error("Save structure failed:", err);
      toast({ title: "Failed to Save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
      setVersionBumpModal(false);
    }
  };

  const handleActivate = async () => {
    if (!activeStructure || !appUser) return;
    try {
      const res = await activateAcademicStructure(activeStructure.id, {
        uid: appUser.id,
        name: appUser.name,
      });
      if (res.success) {
        toast({
          title: "Structure Activated",
          description: `Structure "${activeStructure.name}" is now the active source of truth for grades: ${activeStructure.applicableGrades.join(", ")}.`,
        });
        await reloadData();
      } else {
        toast({ title: "Activation Error", description: res.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleArchive = async () => {
    if (!activeStructure || !appUser) return;
    try {
      await archiveAcademicStructure(activeStructure.id, {
        uid: appUser.id,
        name: appUser.name,
      });
      toast({ title: "Archived", description: "Academic structure has been archived." });
      await reloadData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleCreateNewStructure = async () => {
    if (!appUser || !newStructName.trim()) return;
    try {
      setSaving(true);
      const initialSubjects: StructureSubjectEntry[] = centralSubjects
        .filter((sub) => newStructGrades.includes(sub.grade))
        .sort((a, b) => {
          if (a.grade !== b.grade) return Number(a.grade) - Number(b.grade);
          return (a.order ?? 0) - (b.order ?? 0);
        })
        .map((sub, idx) => ({
          subjectId: sub.id,
          subjectName: sub.name,
          category: (sub.category || "scholastic") as "scholastic" | "co-scholastic",
          order: sub.order ?? idx + 1,
          grade: sub.grade,
          enabledOnReportCard: true,
        }));

      const res = await createAcademicStructure({
        name: newStructName.trim(),
        description: newStructDesc.trim(),
        sessionId: effectiveSessionId,
        academicYear: effectiveSessionName,
        applicableGrades: newStructGrades,
        status: "draft",
        subjects: initialSubjects,
        exams: DEFAULT_PRIMARY_EXAMS,
        assessmentComponents: DEFAULT_PRIMARY_COMPONENTS,
        gradingScale: DEFAULT_CBSE_GRADING_SCALE,
        coScholasticAreas: DEFAULT_CO_SCHOLASTIC,
        scholasticTableConfig: DEFAULT_SCHOLASTIC_TABLE_CONFIG,
        coScholasticConfig: DEFAULT_CO_SCHOLASTIC_CONFIG,
        subjectOverrides: {},
        discreteGradingScales: DEFAULT_DISCRETE_GRADING_SCALES,
        reportCardLayout: DEFAULT_REPORT_CARD_LAYOUT,
        user: { uid: appUser.id, name: appUser.name, email: appUser.email },
      });

      toast({
        title: "Academic Structure Created",
        description: `Structure "${newStructName}" initialized in Draft status.`,
      });

      setNewStructureModal(false);
      setNewStructName("");
      setNewStructDesc("");
      await reloadData();
      setSelectedStructureId(res.structureId);
    } catch (err: any) {
      toast({ title: "Creation Failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!activeStructure || !appUser || !duplicateName.trim()) return;
    try {
      setSaving(true);
      const newId = await duplicateAcademicStructure(
        activeStructure.id,
        duplicateName.trim(),
        effectiveSessionId,
        effectiveSessionName,
        { uid: appUser.id, name: appUser.name, email: appUser.email }
      );
      toast({ title: "Structure Duplicated", description: `Created new draft structure "${duplicateName}".` });
      setDuplicateModal(false);
      setDuplicateName("");
      await reloadData();
      setSelectedStructureId(newId);
    } catch (err: any) {
      toast({ title: "Duplicate Failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // --- Dynamic Assessment Component Handlers ---
  const handleOpenAddComponent = (termId: "term_1" | "term_2") => {
    setCompFormTermId(termId);
    setEditingCompId(null);
    setCompFormData({
      name: "",
      code: "",
      maxMarks: 10,
      testedMaxMarks: 10,
      scalingTargetMarks: 10,
      calculationMethod: "raw",
      contributeToTotal: true,
      displayOnReportCard: true,
      applicableExamId: "",
    });
    setCompDialogOpen(true);
  };

  const handleOpenEditComponent = (termId: "term_1" | "term_2", comp: AssessmentComponent) => {
    setCompFormTermId(termId);
    setEditingCompId(comp.id);
    setCompFormData({
      name: comp.name,
      code: comp.code,
      maxMarks: comp.maxMarks,
      testedMaxMarks: comp.testedMaxMarks ?? comp.maxMarks,
      scalingTargetMarks: comp.scalingTargetMarks ?? comp.maxMarks,
      calculationMethod: comp.calculationMethod ?? "raw",
      contributeToTotal: comp.contributeToTotal !== false,
      displayOnReportCard: comp.displayOnReportCard !== false,
      applicableExamId: comp.applicableExamId || "",
    });
    setCompDialogOpen(true);
  };

  const handleSaveComponentModal = () => {
    if (!compFormData.name.trim() || !compFormData.code.trim()) {
      toast({ title: "Validation Error", description: "Component Name and Code are required.", variant: "destructive" });
      return;
    }

    setScholasticTableConfig((prev) => {
      const updatedTerms = prev.terms.map((t) => {
        if (t.termId !== compFormTermId) return t;

        let newComps = [...(t.assessmentComponents || [])];
        if (editingCompId) {
          newComps = newComps.map((c) =>
            c.id === editingCompId
              ? {
                  ...c,
                  name: compFormData.name.trim(),
                  code: compFormData.code.trim().toUpperCase(),
                  maxMarks: Number(compFormData.maxMarks) || 0,
                  testedMaxMarks: Number(compFormData.testedMaxMarks) || 0,
                  scalingTargetMarks: Number(compFormData.scalingTargetMarks) || 0,
                  calculationMethod: compFormData.calculationMethod,
                  contributeToTotal: compFormData.contributeToTotal,
                  displayOnReportCard: compFormData.displayOnReportCard,
                  applicableExamId: compFormData.applicableExamId || undefined,
                }
              : c
          );
        } else {
          const newComp: AssessmentComponent = {
            id: `comp_${Date.now()}`,
            name: compFormData.name.trim(),
            code: compFormData.code.trim().toUpperCase(),
            maxMarks: Number(compFormData.maxMarks) || 0,
            testedMaxMarks: Number(compFormData.testedMaxMarks) || 0,
            scalingTargetMarks: Number(compFormData.scalingTargetMarks) || 0,
            calculationMethod: compFormData.calculationMethod,
            contributeToTotal: compFormData.contributeToTotal,
            displayOnReportCard: compFormData.displayOnReportCard,
            applicableTermId: compFormTermId,
            applicableExamId: compFormData.applicableExamId || undefined,
            order: newComps.length + 1,
          };
          newComps.push(newComp);
        }

        const updatedTerm = { ...t, assessmentComponents: newComps };
        updatedTerm.maxMarks = deriveTermMaxMarks(updatedTerm);
        return updatedTerm;
      });

      return { ...prev, terms: updatedTerms };
    });

    setCompDialogOpen(false);
  };

  const handleDeleteComponent = (termId: "term_1" | "term_2", compId: string) => {
    setScholasticTableConfig((prev) => {
      const updatedTerms = prev.terms.map((t) => {
        if (t.termId !== termId) return t;
        const newComps = (t.assessmentComponents || []).filter((c) => c.id !== compId);
        const updatedTerm = { ...t, assessmentComponents: newComps };
        updatedTerm.maxMarks = deriveTermMaxMarks(updatedTerm);
        return updatedTerm;
      });
      return { ...prev, terms: updatedTerms };
    });
  };

  const handleMoveComponent = (termId: "term_1" | "term_2", index: number, direction: -1 | 1) => {
    setScholasticTableConfig((prev) => {
      const updatedTerms = prev.terms.map((t) => {
        if (t.termId !== termId) return t;
        const currentComps = t.assessmentComponents || [];
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= currentComps.length) return t;
        const newComps = [...currentComps];
        const temp = newComps[index];
        newComps[index] = newComps[targetIndex];
        newComps[targetIndex] = temp;
        newComps.forEach((c, i) => (c.order = i + 1));
        return { ...t, assessmentComponents: newComps };
      });
      return { ...prev, terms: updatedTerms };
    });
  };

  // --- Dynamic Co-Scholastic Area Handlers ---
  const handleOpenAddArea = () => {
    setEditingAreaId(null);
    setAreaFormData({
      name: "",
      code: "",
      category: "co-scholastic",
      applicableTermIds: ["term_1", "term_2"],
    });
    setAreaDialogOpen(true);
  };

  const handleOpenEditArea = (area: CoScholasticAreaEntry) => {
    setEditingAreaId(area.id);
    setAreaFormData({
      name: area.name,
      code: area.code || "",
      category: area.category,
      applicableTermIds: ["term_1", "term_2"],
    });
    setAreaDialogOpen(true);
  };

  const handleSaveAreaModal = () => {
    if (!areaFormData.name.trim()) {
      toast({ title: "Validation Error", description: "Area name is required.", variant: "destructive" });
      return;
    }

    setCoScholasticConfig((prev) => {
      let updatedAreas = [...prev.areas];
      if (editingAreaId) {
        updatedAreas = updatedAreas.map((a) =>
          a.id === editingAreaId
            ? {
                ...a,
                name: areaFormData.name.trim(),
                code: areaFormData.code.trim().toUpperCase(),
                category: areaFormData.category,
              }
            : a
        );
      } else {
        const newArea: CoScholasticAreaEntry = {
          id: `area_${Date.now()}`,
          name: areaFormData.name.trim(),
          code: areaFormData.code.trim().toUpperCase(),
          category: areaFormData.category,
          displayOnReportCard: true,
          order: updatedAreas.length + 1,
        };
        updatedAreas.push(newArea);
      }
      return { ...prev, areas: updatedAreas };
    });

    setAreaDialogOpen(false);
  };

  const handleDeleteArea = (areaId: string) => {
    setCoScholasticConfig((prev) => ({
      ...prev,
      areas: prev.areas.filter((a) => a.id !== areaId),
    }));
  };

  const handleMoveArea = (index: number, direction: -1 | 1) => {
    setCoScholasticConfig((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.areas.length) return prev;
      const updated = [...prev.areas];
      const temp = updated[index];
      updated[index] = updated[targetIndex];
      updated[targetIndex] = temp;
      updated.forEach((a, i) => (a.order = i + 1));
      return { ...prev, areas: updated };
    });
  };

  return (
    <div data-testid="academic-structure-planner" className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 gradient-banner rounded-2xl p-6 text-white shadow-lg">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-200 border border-blue-400/30">
              Session: {effectiveSessionName}
            </span>
            {activeStructure && (
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                  activeStructure.status === "active"
                    ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/40"
                    : activeStructure.status === "draft"
                    ? "bg-amber-500/20 text-amber-200 border-amber-400/40"
                    : "bg-slate-500/20 text-slate-300 border-slate-400/40"
                }`}
              >
                {activeStructure.status.toUpperCase()}
              </span>
            )}
            {activeStructure && (
              <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white font-mono">
                v{activeStructure.currentVersion || 1}
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Academic Structure Planner</h1>
          <p className="mt-1 text-sm text-slate-300">
            Single source of truth for Exams, Assessments, Grading Scales, and Formal Report Cards.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeStructure && activeStructure.status !== "active" && (
            <Button
              onClick={handleActivate}
              variant="secondary"
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-0 gap-1.5 shadow-sm"
            >
              <CheckCircle2 size={16} /> Activate Structure
            </Button>
          )}

          <Button
            onClick={() => handleSaveStructure(false)}
            disabled={saving || !activeStructure}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-sm"
          >
            <Save size={16} /> Save Changes
          </Button>

          <Button
            onClick={() => setVersionBumpModal(true)}
            disabled={saving || !activeStructure}
            variant="outline"
            className="bg-white/10 border-white/20 hover:bg-white/20 text-white gap-1.5"
          >
            <History size={16} /> New Version (v{(activeStructure?.currentVersion || 1) + 1})
          </Button>

          <Button
            onClick={() => setNewStructureModal(true)}
            variant="outline"
            className="bg-white/10 border-white/20 hover:bg-white/20 text-white gap-1.5"
          >
            <Plus size={16} /> + New Structure
          </Button>
        </div>
      </div>

      {/* Structure Selector Bar */}
      <div className="glass-card-strong rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Layers className="text-primary shrink-0" size={20} />
          <Label className="text-sm font-semibold shrink-0">Selected Structure:</Label>
          <Select value={selectedStructureId} onValueChange={handleSelectStructure}>
            <SelectTrigger className="w-full md:w-80 bg-background">
              <SelectValue placeholder="Select an academic structure..." />
            </SelectTrigger>
            <SelectContent>
              {structures.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      (Grades {s.applicableGrades.join(", ")})
                    </span>
                    <Badge variant={s.status === "active" ? "default" : "secondary"} className="text-[10px] py-0 px-1.5">
                      {s.status}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {activeStructure && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDuplicateName(`${activeStructure.name} (Copy)`);
                setDuplicateModal(true);
              }}
              className="gap-1.5 text-xs"
            >
              <Copy size={13} /> Duplicate
            </Button>
            {activeStructure.status !== "archived" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleArchive}
                className="gap-1.5 text-xs text-amber-600 hover:text-amber-700"
              >
                <Archive size={13} /> Archive
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Main Workspace: Split-Screen View */}
      {activeStructure ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Column: Configuration Tabs (7 cols on xl) */}
          <div className="xl:col-span-7 space-y-4">
            <Tabs defaultValue="scope" className="w-full">
              <TabsList className="grid grid-cols-4 sm:grid-cols-8 h-auto p-1 bg-muted/60 rounded-xl">
                <TabsTrigger value="scope" className="text-xs py-2 gap-1">
                  <Layers size={13} /> Scope
                </TabsTrigger>
                <TabsTrigger value="subjects" className="text-xs py-2 gap-1">
                  <BookOpen size={13} /> Subjects ({applicableCentralSubjects.length})
                </TabsTrigger>
                <TabsTrigger value="terms" className="text-xs py-2 gap-1">
                  <CalendarDays size={13} /> Terms
                </TabsTrigger>
                <TabsTrigger value="annual" className="text-xs py-2 gap-1">
                  <ArrowUpDown size={13} /> Annual
                </TabsTrigger>
                <TabsTrigger value="scholastic" className="text-xs py-2 gap-1">
                  <SlidersHorizontal size={13} /> Scholastic
                </TabsTrigger>
                <TabsTrigger value="coscholastic" className="text-xs py-2 gap-1">
                  <Sparkles size={13} /> Co-Scholastic
                </TabsTrigger>
                <TabsTrigger value="grading" className="text-xs py-2 gap-1">
                  <Award size={13} /> Grading
                </TabsTrigger>
                <TabsTrigger value="reportCard" className="text-xs py-2 gap-1">
                  <FileText size={13} /> Layout
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: BASIC INFORMATION & APPLICABLE GRADES */}
              <TabsContent value="scope" className="space-y-4 mt-4">
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold">Structure Identity & Grade Scope</CardTitle>
                    <CardDescription className="text-xs">
                      Define the name and grades that will inherit this examination and report card structure.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs font-semibold">Structure Name</Label>
                        <Input
                          value={structureName}
                          onChange={(e) => setStructureName(e.target.value)}
                          placeholder="e.g. Primary Wing (Grades 1-5)"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Academic Session</Label>
                        <Input value={effectiveSessionName} disabled className="mt-1 bg-muted/50" />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-semibold">Description / Notes</Label>
                      <Input
                        value={structureDesc}
                        onChange={(e) => setStructureDesc(e.target.value)}
                        placeholder="Academic structure governing continuous assessment, periodic tests, and term exams."
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-semibold mb-2 block">
                        Applicable Grades (Select all classes governed by this structure)
                      </Label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {ALL_GRADES.map((grade) => {
                          const isSelected = selectedGrades.includes(grade);
                          return (
                            <button
                              key={grade}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedGrades(selectedGrades.filter((g) => g !== grade));
                                } else {
                                  setSelectedGrades([...selectedGrades, grade].sort((a, b) => Number(a) - Number(b)));
                                }
                              }}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                  : "bg-background text-muted-foreground border-border hover:bg-muted"
                              }`}
                            >
                              Grade {grade}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Note: When active, HODs can schedule exams for these grades using ONLY this structure's defined exams.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Linked Subjects Summary in Scope */}
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <BookOpen size={16} className="text-primary" />
                        Linked Subjects from Admin Panel
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Curriculum subjects configured in Admin &gt; Subjects for this structure's grades.
                      </CardDescription>
                    </div>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                    >
                      <Link href="/admin/subjects">
                        <ExternalLink size={12} /> Manage in Admin
                      </Link>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {selectedGrades.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No grades selected yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {selectedGrades.map((grade) => {
                          const gradeSubjs = subjectsByGrade[grade] || [];
                          const scholasticCount = gradeSubjs.filter((s) => (s.category || "scholastic") === "scholastic").length;
                          const coScholasticCount = gradeSubjs.filter((s) => s.category === "co-scholastic").length;
                          return (
                            <div key={grade} className="p-3 rounded-xl border bg-muted/20 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-foreground">Grade {grade}</span>
                                <Badge variant={gradeSubjs.length > 0 ? "secondary" : "destructive"} className="text-[10px] font-bold">
                                  {gradeSubjs.length} subjects
                                </Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground space-y-0.5">
                                <div>Scholastic: <strong className="text-foreground">{scholasticCount}</strong></div>
                                <div>Co-Scholastic: <strong className="text-foreground">{coScholasticCount}</strong></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TAB 2: SUBJECTS (LINKED FROM ADMIN PANEL) */}
              <TabsContent value="subjects" className="space-y-4 mt-4">
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                          <BookOpen size={18} className="text-primary" />
                          Canonical Subjects Directory
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Subjects are sourced directly from Admin &gt; Subjects. Any changes made in the Admin Subjects directory automatically govern examinations, marks entry, and report cards.
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => reloadData()}
                          disabled={loading}
                          className="h-8 text-xs gap-1.5"
                        >
                          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                          Refresh Subjects
                        </Button>
                        <Button
                          asChild
                          size="sm"
                          className="h-8 text-xs gap-1.5"
                        >
                          <Link href="/admin/subjects">
                            <ExternalLink size={13} /> Manage in Admin Panel
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {selectedGrades.length === 0 ? (
                      <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                        No grades selected for this structure. Please select applicable grades in the <strong>Scope</strong> tab first.
                      </div>
                    ) : (
                      selectedGrades.map((grade) => {
                        const gradeSubjs = subjectsByGrade[grade] || [];
                        const scholasticSubjs = gradeSubjs.filter((s) => (s.category || "scholastic") === "scholastic");
                        const coScholasticSubjs = gradeSubjs.filter((s) => s.category === "co-scholastic");

                        return (
                          <div key={grade} className="border rounded-xl p-4 bg-card space-y-3">
                            <div className="flex items-center justify-between pb-2 border-b">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-foreground">Grade {grade}</span>
                                <Badge variant="secondary" className="text-[10px]">
                                  {gradeSubjs.length} Total Subjects
                                </Badge>
                                {scholasticSubjs.length > 0 && (
                                  <Badge variant="outline" className="text-[10px] text-blue-700 bg-blue-50 border-blue-200">
                                    {scholasticSubjs.length} Scholastic
                                  </Badge>
                                )}
                                {coScholasticSubjs.length > 0 && (
                                  <Badge variant="outline" className="text-[10px] text-purple-700 bg-purple-50 border-purple-200">
                                    {coScholasticSubjs.length} Co-Scholastic
                                  </Badge>
                                )}
                              </div>
                              <Button
                                asChild
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
                              >
                                <Link href="/admin/subjects">
                                  Edit in Admin <ExternalLink size={11} />
                                </Link>
                              </Button>
                            </div>

                            {gradeSubjs.length === 0 ? (
                              <div className="p-4 text-center text-xs text-amber-700 bg-amber-50/50 border border-amber-200 rounded-lg flex items-center justify-between">
                                <span>No subjects configured for Grade {grade} in Admin &gt; Subjects.</span>
                                <Button asChild size="sm" variant="outline" className="h-7 text-xs bg-white">
                                  <Link href="/admin/subjects">+ Add Subjects for Grade {grade}</Link>
                                </Button>
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b text-muted-foreground text-left">
                                      <th className="py-2 px-2 w-16 font-medium">Order</th>
                                      <th className="py-2 px-2 font-medium">Subject Name</th>
                                      <th className="py-2 px-2 font-medium">Category</th>
                                      <th className="py-2 px-2 font-medium">Report Card Destination</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/50">
                                    {gradeSubjs.map((s, idx) => {
                                      const isScholastic = (s.category || "scholastic") === "scholastic";
                                      return (
                                        <tr key={s.id} className="hover:bg-muted/30">
                                          <td className="py-2 px-2 font-mono text-muted-foreground">
                                            #{s.order ?? idx + 1}
                                          </td>
                                          <td className="py-2 px-2 font-semibold text-foreground">
                                            {s.name}
                                          </td>
                                          <td className="py-2 px-2">
                                            <Badge
                                              variant="outline"
                                              className={
                                                isScholastic
                                                  ? "text-blue-700 bg-blue-50 border-blue-200"
                                                  : "text-purple-700 bg-purple-50 border-purple-200"
                                              }
                                            >
                                              {isScholastic ? "Scholastic" : "Co-Scholastic"}
                                            </Badge>
                                          </td>
                                          <td className="py-2 px-2 text-muted-foreground">
                                            {isScholastic
                                              ? "Part 1: Scholastic Assessment Table"
                                              : "Part 2: Co-Scholastic Activities"}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TAB 2: TERMS (TERM 1 & TERM 2) */}
              <TabsContent value="terms" className="space-y-4 mt-4">
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base font-semibold">Two-Term Academic Period Configuration</CardTitle>
                        <CardDescription className="text-xs">
                          Configure dates, workflow status, and defined examinations for Term 1 and Term 2.
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="text-xs font-semibold bg-primary/5 text-primary border-primary/20">
                        2 Academic Terms
                      </Badge>
                    </div>

                    {/* Sub-tabs for Term 1 and Term 2 */}
                    <div className="flex gap-2 pt-3">
                      {terms.map((t) => (
                        <Button
                          key={t.id}
                          type="button"
                          variant={activeTermSubTab === t.id ? "default" : "outline"}
                          size="sm"
                          className="h-8 text-xs px-4"
                          onClick={() => setActiveTermSubTab(t.id)}
                        >
                          {t.name}
                          <Badge variant="secondary" className="ml-2 text-[10px] py-0 px-1">
                            {exams.filter((e) => (e.termId === t.id) || (!e.termId && (t.id === "term_1" ? e.term === "term1" : e.term === "term2"))).length} exams
                          </Badge>
                        </Button>
                      ))}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {(() => {
                      const curTermIdx = terms.findIndex((t) => t.id === activeTermSubTab);
                      const curTerm = terms[curTermIdx] || terms[0];
                      if (!curTerm) return null;

                      const termExams = exams.filter(
                        (e) => (e.termId === curTerm.id) || (!e.termId && (curTerm.id === "term_1" ? e.term === "term1" : e.term === "term2"))
                      );

                      return (
                        <div className="space-y-4">
                          {/* Term Period Details */}
                          <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div>
                                <Label className="text-xs font-medium">Term Title</Label>
                                <Input
                                  value={curTerm.name}
                                  onChange={(e) => {
                                    const updated = [...terms];
                                    updated[curTermIdx].name = e.target.value;
                                    setTerms(updated);
                                  }}
                                  className="h-8 text-xs mt-1 bg-white"
                                />
                              </div>
                              <div>
                                <Label className="text-xs font-medium">Start Date</Label>
                                <Input
                                  type="date"
                                  value={curTerm.startDate || ""}
                                  onChange={(e) => {
                                    const updated = [...terms];
                                    updated[curTermIdx].startDate = e.target.value;
                                    setTerms(updated);
                                  }}
                                  className="h-8 text-xs mt-1 bg-white"
                                />
                              </div>
                              <div>
                                <Label className="text-xs font-medium">End Date</Label>
                                <Input
                                  type="date"
                                  value={curTerm.endDate || ""}
                                  onChange={(e) => {
                                    const updated = [...terms];
                                    updated[curTermIdx].endDate = e.target.value;
                                    setTerms(updated);
                                  }}
                                  className="h-8 text-xs mt-1 bg-white"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Defined Examinations for this Term */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                                Defined Examinations for {curTerm.name}
                              </h4>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const newExam: DefinedExam = {
                                    id: `exam-${curTerm.id}-${Date.now()}`,
                                    name: `${curTerm.name} Exam ${termExams.length + 1}`,
                                    term: curTerm.id === "term_2" ? "term2" : "term1",
                                    termId: curTerm.id,
                                    code: curTerm.id === "term_2" ? "ANN" : "HY",
                                    order: exams.length + 1,
                                    weightagePercentage: 50,
                                    assessmentComponentIds: components.map((c) => c.id),
                                  };
                                  setExams([...exams, newExam]);
                                }}
                                className="h-7 text-xs gap-1"
                              >
                                <Plus size={13} /> Add Exam to {curTerm.name}
                              </Button>
                            </div>

                            {termExams.map((ex) => {
                              const overallIdx = exams.findIndex((e) => e.id === ex.id);
                              return (
                                <div
                                  key={ex.id}
                                  className="p-3 rounded-xl border bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                                >
                                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                    <div>
                                      <Label className="text-[11px] font-medium text-muted-foreground">Exam Name</Label>
                                      <Input
                                        value={ex.name}
                                        onChange={(e) => {
                                          const updated = [...exams];
                                          updated[overallIdx].name = e.target.value;
                                          setExams(updated);
                                        }}
                                        className="h-8 text-xs mt-0.5"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-[11px] font-medium text-muted-foreground">Exam Code</Label>
                                      <Input
                                        value={ex.code || ""}
                                        placeholder="e.g. PT1, HY"
                                        onChange={(e) => {
                                          const updated = [...exams];
                                          updated[overallIdx].code = e.target.value.toUpperCase();
                                          setExams(updated);
                                        }}
                                        className="h-8 text-xs mt-0.5 font-mono"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-[11px] font-medium text-muted-foreground">Term Weight %</Label>
                                      <Input
                                        type="number"
                                        value={ex.weightagePercentage}
                                        onChange={(e) => {
                                          const updated = [...exams];
                                          updated[overallIdx].weightagePercentage = Number(e.target.value) || 0;
                                          setExams(updated);
                                        }}
                                        className="h-8 text-xs mt-0.5"
                                      />
                                    </div>
                                  </div>

                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setExams(exams.filter((e) => e.id !== ex.id))}
                                    className="text-red-500 hover:text-red-700 h-8 w-8 shrink-0 self-end sm:self-center"
                                  >
                                    <Trash2 size={15} />
                                  </Button>
                                </div>
                              );
                            })}

                            {termExams.length === 0 && (
                              <p className="text-center py-6 text-xs text-muted-foreground border rounded-xl border-dashed">
                                No exams configured for {curTerm.name}. Click "+ Add Exam to {curTerm.name}" above.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TAB 3: ANNUAL CALCULATION & TERM AGGREGATION */}
              <TabsContent value="annual" className="space-y-4 mt-4">
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold">Annual Result Aggregation & Contribution</CardTitle>
                    <CardDescription className="text-xs">
                      Define how Term 1 and Term 2 contribute to the Final Annual Result (e.g. 40% / 60% or 50% / 50%).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* Aggregation Method */}
                    <div>
                      <Label className="text-xs font-semibold">Aggregation Formula</Label>
                      <Select
                        value={calcConfig.termAggregation || "weighted_average"}
                        onValueChange={(val: any) => {
                          setCalcConfig({
                            ...calcConfig,
                            termAggregation: val,
                          });
                        }}
                      >
                        <SelectTrigger className="mt-1 h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weighted_average">Weighted Average of Term 1 & Term 2 (CBSE Default)</SelectItem>
                          <SelectItem value="equal_average">Equal 50% / 50% Contribution</SelectItem>
                          <SelectItem value="direct_sum">Direct Sum of Scores</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Term Weights */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Term Contribution Weights</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-3.5 rounded-xl border bg-muted/20 space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Term 1 Weight (%)</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={calcConfig.termWeights?.term_1 ?? 50}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              setCalcConfig({
                                ...calcConfig,
                                termWeights: {
                                  ...calcConfig.termWeights,
                                  term_1: val,
                                },
                              });
                            }}
                            className="h-8 text-xs mt-1 bg-white"
                          />
                          <p className="text-[10px] text-muted-foreground">e.g. 40% or 50%</p>
                        </div>

                        <div className="p-3.5 rounded-xl border bg-muted/20 space-y-1">
                          <Label className="text-xs font-medium text-slate-700">Term 2 Weight (%)</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={calcConfig.termWeights?.term_2 ?? 50}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              setCalcConfig({
                                ...calcConfig,
                                termWeights: {
                                  ...calcConfig.termWeights,
                                  term_2: val,
                                },
                              });
                            }}
                            className="h-8 text-xs mt-1 bg-white"
                          />
                          <p className="text-[10px] text-muted-foreground">e.g. 60% or 50%</p>
                        </div>
                      </div>

                      {/* Weight Validation Alert */}
                      {(() => {
                        const sum = (calcConfig.termWeights?.term_1 ?? 0) + (calcConfig.termWeights?.term_2 ?? 0);
                        if (sum === 100) {
                          return (
                            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                              <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                              <span>Valid configuration: Term 1 ({calcConfig.termWeights?.term_1}%) + Term 2 ({calcConfig.termWeights?.term_2}%) = 100%.</span>
                            </div>
                          );
                        } else {
                          return (
                            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                              <AlertTriangle size={15} className="shrink-0 text-rose-600" />
                              <span>Term weights must sum to exactly 100%. Current sum: <strong>{sum}%</strong>.</span>
                            </div>
                          );
                        }
                      })()}
                    </div>

                    {/* Institutional Passing Rules */}
                    <div className="space-y-3 pt-2 border-t">
                      <Label className="text-xs font-semibold">Institutional Passing & Promotion Rules</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-[11px] font-medium text-muted-foreground">Minimum Scholastic Pass %</Label>
                          <Input
                            type="number"
                            value={calcConfig.institutionalPassingRules?.minScholasticPercentage ?? 33}
                            onChange={(e) => {
                              setCalcConfig({
                                ...calcConfig,
                                institutionalPassingRules: {
                                  minAttendancePercentage: calcConfig.institutionalPassingRules?.minAttendancePercentage ?? 75,
                                  ...calcConfig.institutionalPassingRules,
                                  minScholasticPercentage: Number(e.target.value) || 33,
                                },
                              });
                            }}
                            className="h-8 text-xs mt-1"
                          />
                        </div>

                        <div>
                          <Label className="text-[11px] font-medium text-muted-foreground">Minimum Attendance %</Label>
                          <Input
                            type="number"
                            value={calcConfig.institutionalPassingRules?.minAttendancePercentage ?? 75}
                            onChange={(e) => {
                              setCalcConfig({
                                ...calcConfig,
                                institutionalPassingRules: {
                                  minScholasticPercentage: calcConfig.institutionalPassingRules?.minScholasticPercentage ?? 33,
                                  ...calcConfig.institutionalPassingRules,
                                  minAttendancePercentage: Number(e.target.value) || 75,
                                },
                              });
                            }}
                            className="h-8 text-xs mt-1"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TAB 3: SCHOLASTIC TABLE BUILDER */}
              <TabsContent value="scholastic" className="space-y-4 mt-4">
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                          <SlidersHorizontal size={18} className="text-primary" />
                          Scholastic Table Builder
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Configure multi-term assessment columns, maximum marks, scaling, and subject-specific overrides.
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {(scholasticTableConfig.terms || []).map((t) => (
                          <Badge key={t.termId} variant="outline" className="text-xs py-1 px-2.5 bg-background font-mono">
                            {t.termName || t.termId}: {deriveTermMaxMarks(t)} Marks
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Sub-tab Navigation */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-3 border-b pb-2">
                      <Button
                        size="sm"
                        type="button"
                        variant={activeScholasticSubTab === "term_1" ? "default" : "ghost"}
                        onClick={() => setActiveScholasticSubTab("term_1")}
                        className="h-7 text-xs px-3 rounded-lg"
                      >
                        Term 1 Components ({scholasticTableConfig.terms?.find((t) => t.termId === "term_1")?.assessmentComponents?.length || 0})
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant={activeScholasticSubTab === "term_2" ? "default" : "ghost"}
                        onClick={() => setActiveScholasticSubTab("term_2")}
                        className="h-7 text-xs px-3 rounded-lg"
                      >
                        Term 2 Components ({scholasticTableConfig.terms?.find((t) => t.termId === "term_2")?.assessmentComponents?.length || 0})
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant={activeScholasticSubTab === "overrides" ? "default" : "ghost"}
                        onClick={() => setActiveScholasticSubTab("overrides")}
                        className="h-7 text-xs px-3 rounded-lg"
                      >
                        Subject Overrides ({Object.keys(subjectOverrides || {}).length})
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant={activeScholasticSubTab === "overall" ? "default" : "ghost"}
                        onClick={() => setActiveScholasticSubTab("overall")}
                        className="h-7 text-xs px-3 rounded-lg"
                      >
                        Overall Columns & Rank
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4 pt-2">
                    {/* SUB-TAB: TERM 1 OR TERM 2 */}
                    {(activeScholasticSubTab === "term_1" || activeScholasticSubTab === "term_2") && (
                      <div className="space-y-3">
                        {(() => {
                          const currentTerm = scholasticTableConfig.terms?.find((t) => t.termId === activeScholasticSubTab) || scholasticTableConfig.terms?.[0] || DEFAULT_SCHOLASTIC_TABLE_CONFIG.terms[0];
                          const termComps = currentTerm?.assessmentComponents || [];

                          return (
                            <>
                              <div className="flex items-center justify-between bg-muted/40 p-3 rounded-xl border">
                                <div>
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                    {currentTerm?.termName || "Term"} Components
                                  </h4>
                                  <p className="text-[11px] text-muted-foreground">
                                    Sum of contributing components: <strong className="text-foreground">{deriveTermMaxMarks(currentTerm)} Marks</strong>
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  type="button"
                                  onClick={() => handleOpenAddComponent(activeScholasticSubTab as "term_1" | "term_2")}
                                  className="gap-1.5 text-xs h-8"
                                >
                                  <Plus size={14} /> Add Component
                                </Button>
                              </div>

                              <div className="space-y-2">
                                {termComps.map((comp, idx) => (
                                  <div
                                    key={comp.id}
                                    className="p-3 rounded-xl border bg-card hover:bg-muted/10 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      <div className="flex flex-col gap-0.5">
                                        <button
                                          type="button"
                                          disabled={idx === 0}
                                          onClick={() => handleMoveComponent(activeScholasticSubTab as "term_1" | "term_2", idx, -1)}
                                          className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                                        >
                                          <ArrowUp size={12} />
                                        </button>
                                        <button
                                          type="button"
                                          disabled={idx === termComps.length - 1}
                                          onClick={() => handleMoveComponent(activeScholasticSubTab as "term_1" | "term_2", idx, 1)}
                                          className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                                        >
                                          <ArrowDown size={12} />
                                        </button>
                                      </div>
                                      <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 bg-muted/50 font-bold">
                                        {comp.code}
                                      </Badge>
                                      <div>
                                        <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                                          {comp.name}
                                          {comp.calculationMethod === "scale_to_target" && (
                                            <span className="text-[10px] text-amber-600 font-normal">
                                              (Scaled from {comp.testedMaxMarks})
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                          <span>Target: <strong className="text-foreground">{comp.scalingTargetMarks ?? comp.maxMarks} Marks</strong></span>
                                          <span>•</span>
                                          <span>Method: {comp.calculationMethod || "raw"}</span>
                                          <span>•</span>
                                          <span className={comp.contributeToTotal ? "text-emerald-600" : "text-amber-600"}>
                                            {comp.contributeToTotal ? "In Total" : "Excluded from Total"}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 self-end sm:self-center">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        type="button"
                                        onClick={() => handleOpenEditComponent(activeScholasticSubTab as "term_1" | "term_2", comp)}
                                        className="h-8 text-xs gap-1"
                                      >
                                        <Edit2 size={12} /> Edit
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        onClick={() => handleDeleteComponent(activeScholasticSubTab as "term_1" | "term_2", comp.id)}
                                        className="text-red-500 hover:text-red-700 h-8 w-8"
                                      >
                                        <Trash2 size={14} />
                                      </Button>
                                    </div>
                                  </div>
                                ))}

                                {termComps.length === 0 && (
                                  <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                                    No components defined for this term. Click "+ Add Component" above.
                                  </div>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* SUB-TAB: SUBJECT OVERRIDES */}
                    {activeScholasticSubTab === "overrides" && (
                      <div className="space-y-4">
                        <div className="p-3 bg-muted/30 rounded-xl border space-y-2">
                          <Label className="text-xs font-semibold">Select Subject to Configure Overrides</Label>
                          <Select
                            value={selectedOverrideSubjId}
                            onValueChange={(val) => setSelectedOverrideSubjId(val)}
                          >
                            <SelectTrigger className="bg-background text-xs">
                              <SelectValue placeholder="Choose a subject..." />
                            </SelectTrigger>
                            <SelectContent>
                              {centralSubjects
                                .filter((s) => selectedGrades.includes(s.grade))
                                .sort((a, b) => {
                                  if (a.grade !== b.grade) return Number(a.grade) - Number(b.grade);
                                  return (a.order ?? 0) - (b.order ?? 0);
                                })
                                .map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.name} — Grade {s.grade} ({s.category || "scholastic"})
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-muted-foreground">
                            Use overrides when a specific subject requires custom component weightages (e.g. Science Practicals, Computer Lab, Painting).
                          </p>
                        </div>

                        {selectedOverrideSubjId && (
                          <div className="p-4 rounded-xl border bg-card space-y-4 shadow-sm">
                            <div className="flex items-center justify-between pb-2 border-b">
                              <div>
                                <h4 className="text-xs font-bold text-foreground">
                                  {centralSubjects.find((s) => s.id === selectedOverrideSubjId)?.name} Overrides
                                </h4>
                                <p className="text-[11px] text-muted-foreground">
                                  Toggle custom component hierarchy for this subject.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={!!subjectOverrides[selectedOverrideSubjId]?.useCustomComponents}
                                  onCheckedChange={(checked) => {
                                    setSubjectOverrides((prev) => {
                                      const existing = prev[selectedOverrideSubjId] || {
                                        subjectId: selectedOverrideSubjId,
                                        useCustomComponents: false,
                                      };
                                      return {
                                        ...prev,
                                        [selectedOverrideSubjId]: {
                                          ...existing,
                                          useCustomComponents: checked,
                                          termOverrides: existing.termOverrides || {
                                            term_1: {
                                              assessmentComponents: scholasticTableConfig.terms[0]?.assessmentComponents.map((c) => ({ ...c })) || [],
                                            },
                                            term_2: {
                                              assessmentComponents: scholasticTableConfig.terms[1]?.assessmentComponents.map((c) => ({ ...c })) || [],
                                            },
                                          },
                                        },
                                      };
                                    });
                                  }}
                                />
                                <Label className="text-xs font-medium">Custom Components</Label>
                              </div>
                            </div>

                            {subjectOverrides[selectedOverrideSubjId]?.useCustomComponents ? (
                              <div className="space-y-3">
                                <p className="text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-200">
                                  Custom components are active for this subject. This subject will use its own component structure instead of the default global terms.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {["term_1", "term_2"].map((tId) => {
                                    const tComps = subjectOverrides[selectedOverrideSubjId]?.termOverrides?.[tId]?.assessmentComponents || [];
                                    const tName = tId === "term_1" ? "Term 1" : "Term 2";
                                    return (
                                      <div key={tId} className="p-3 rounded-lg border bg-muted/20 space-y-2">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-bold uppercase">{tName} Components</span>
                                          <Badge variant="outline" className="text-[10px]">
                                            {tComps.length} Comps
                                          </Badge>
                                        </div>
                                        <div className="space-y-1">
                                          {tComps.map((c) => (
                                            <div key={c.id} className="text-xs p-1.5 rounded bg-background border flex items-center justify-between">
                                              <span>{c.code}: {c.name}</span>
                                              <span className="font-semibold">{c.scalingTargetMarks ?? c.maxMarks}M</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">
                                This subject currently inherits the global assessment components. Enable the switch above to override.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* SUB-TAB: OVERALL & COLUMNS */}
                    {activeScholasticSubTab === "overall" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <Label className="text-xs font-semibold">Overall Section Title</Label>
                            <Input
                              value={scholasticTableConfig.overallConfig?.title || "OVERALL"}
                              onChange={(e) =>
                                setScholasticTableConfig((prev) => {
                                  const cur = prev.overallConfig || prev.overall || DEFAULT_SCHOLASTIC_TABLE_CONFIG.overallConfig;
                                  const updated = { ...cur, title: e.target.value };
                                  return { ...prev, overallConfig: updated, overall: updated };
                                })
                              }
                              placeholder="OVERALL"
                              className="mt-1 h-8 text-xs font-bold"
                            />
                          </div>
                          <div>
                            <Label className="text-xs font-semibold">Overall Subtitle</Label>
                            <Input
                              value={scholasticTableConfig.overallConfig?.subtitle || "Term 1 + Term 2"}
                              onChange={(e) =>
                                setScholasticTableConfig((prev) => {
                                  const cur = prev.overallConfig || prev.overall || DEFAULT_SCHOLASTIC_TABLE_CONFIG.overallConfig;
                                  const updated = { ...cur, subtitle: e.target.value };
                                  return { ...prev, overallConfig: updated, overall: updated };
                                })
                              }
                              placeholder="Term 1 + Term 2"
                              className="mt-1 h-8 text-xs"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t">
                          <div>
                            <Label className="text-xs font-semibold">Term 1 Weight (%)</Label>
                            <Input
                              type="number"
                              value={scholasticTableConfig.overallConfig?.term1Weight ?? 50}
                              onChange={(e) =>
                                setScholasticTableConfig((prev) => {
                                  const cur = prev.overallConfig || prev.overall || DEFAULT_SCHOLASTIC_TABLE_CONFIG.overallConfig;
                                  const updated = { ...cur, term1Weight: Number(e.target.value) || 0 };
                                  return { ...prev, overallConfig: updated, overall: updated };
                                })
                              }
                              className="mt-1 h-8 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-xs font-semibold">Term 2 Weight (%)</Label>
                            <Input
                              type="number"
                              value={scholasticTableConfig.overallConfig?.term2Weight ?? 50}
                              onChange={(e) =>
                                setScholasticTableConfig((prev) => {
                                  const cur = prev.overallConfig || prev.overall || DEFAULT_SCHOLASTIC_TABLE_CONFIG.overallConfig;
                                  const updated = { ...cur, term2Weight: Number(e.target.value) || 0 };
                                  return { ...prev, overallConfig: updated, overall: updated };
                                })
                              }
                              className="mt-1 h-8 text-xs"
                            />
                          </div>
                        </div>

                        <div className="space-y-3 pt-3 border-t">
                          <Label className="text-xs font-semibold block">Visible Columns under OVERALL</Label>
                          
                          <div className="flex items-center justify-between p-3 rounded-xl border bg-muted/20">
                            <div>
                              <div className="text-xs font-semibold">Show Grand Total / Consolidated Marks</div>
                              <div className="text-[11px] text-muted-foreground">Renders the combined Term 1 + Term 2 total column.</div>
                            </div>
                            <Switch
                              checked={scholasticTableConfig.overallConfig?.showOverallTotal ?? true}
                              onCheckedChange={(val) =>
                                setScholasticTableConfig((prev) => {
                                  const cur = prev.overallConfig || prev.overall || DEFAULT_SCHOLASTIC_TABLE_CONFIG.overallConfig;
                                  const updated = { ...cur, showOverallTotal: val, showGrandTotal: val };
                                  return { ...prev, overallConfig: updated, overall: updated };
                                })
                              }
                            />
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-xl border bg-muted/20">
                            <div>
                              <div className="text-xs font-semibold">Show Final Grade Column</div>
                              <div className="text-[11px] text-muted-foreground">Calculates and displays A1, A2, etc. based on final overall marks.</div>
                            </div>
                            <Switch
                              checked={scholasticTableConfig.overallConfig?.showGrade ?? true}
                              onCheckedChange={(val) =>
                                setScholasticTableConfig((prev) => {
                                  const cur = prev.overallConfig || prev.overall || DEFAULT_SCHOLASTIC_TABLE_CONFIG.overallConfig;
                                  const updated = { ...cur, showGrade: val };
                                  return { ...prev, overallConfig: updated, overall: updated };
                                })
                              }
                            />
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-xl border bg-primary/5 border-primary/20">
                            <div>
                              <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                Show Student Rank Column
                                <Badge className="text-[10px] py-0 px-1 bg-primary text-primary-foreground">Optional</Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                When enabled, calculates and displays class/section rank in the scholastic table as seen on the reference report card.
                              </div>
                            </div>
                            <Switch
                              checked={scholasticTableConfig.overallConfig?.showRank ?? true}
                              onCheckedChange={(val) =>
                                setScholasticTableConfig((prev) => {
                                  const cur = prev.overallConfig || prev.overall || DEFAULT_SCHOLASTIC_TABLE_CONFIG.overallConfig;
                                  const updated = { ...cur, showRank: val };
                                  return { ...prev, overallConfig: updated, overall: updated };
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TAB 4: CONFIGURABLE GRADING SCALE */}
              <TabsContent value="grading" className="space-y-4 mt-4">
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">Grading Scale Tiers</CardTitle>
                      <CardDescription className="text-xs">
                        Configure percentage cutoffs, grade letters (A1, A2, B1...), and grade points.
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setGradingScale(DEFAULT_CBSE_GRADING_SCALE)}
                      className="text-xs"
                    >
                      Reset to CBSE Standard
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs font-semibold">Grading Scale Name</Label>
                        <Input
                          value={gradingScale.name}
                          onChange={(e) => setGradingScale({ ...gradingScale, name: e.target.value })}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Minimum Passing Percentage (%)</Label>
                        <Input
                          type="number"
                          value={gradingScale.passingPercentage}
                          onChange={(e) =>
                            setGradingScale({
                              ...gradingScale,
                              passingPercentage: Number(e.target.value) || 33,
                            })
                          }
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 border rounded-xl p-3 bg-muted/10">
                      <div className="grid grid-cols-12 text-[11px] font-semibold text-muted-foreground pb-1 border-b">
                        <span className="col-span-3">Grade Symbol</span>
                        <span className="col-span-3">Min %</span>
                        <span className="col-span-3">Max %</span>
                        <span className="col-span-3">Grade Point</span>
                      </div>
                      {gradingScale.tiers.map((tier, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <Input
                            value={tier.grade}
                            onChange={(e) => {
                              const updated = [...gradingScale.tiers];
                              updated[idx].grade = e.target.value;
                              setGradingScale({ ...gradingScale, tiers: updated });
                            }}
                            className="col-span-3 h-8 text-xs font-bold"
                          />
                          <Input
                            type="number"
                            value={tier.minPercentage}
                            onChange={(e) => {
                              const updated = [...gradingScale.tiers];
                              updated[idx].minPercentage = Number(e.target.value) || 0;
                              setGradingScale({ ...gradingScale, tiers: updated });
                            }}
                            className="col-span-3 h-8 text-xs"
                          />
                          <Input
                            type="number"
                            value={tier.maxPercentage}
                            onChange={(e) => {
                              const updated = [...gradingScale.tiers];
                              updated[idx].maxPercentage = Number(e.target.value) || 0;
                              setGradingScale({ ...gradingScale, tiers: updated });
                            }}
                            className="col-span-3 h-8 text-xs"
                          />
                          <Input
                            type="number"
                            value={tier.gradePoint ?? ""}
                            onChange={(e) => {
                              const updated = [...gradingScale.tiers];
                              updated[idx].gradePoint = Number(e.target.value) || 0;
                              setGradingScale({ ...gradingScale, tiers: updated });
                            }}
                            className="col-span-3 h-8 text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TAB 5: REPORT CARD SECTIONS & HEADER */}
              <TabsContent value="reportCard" className="space-y-4 mt-4">
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold">Institutional Header & Layout</CardTitle>
                    <CardDescription className="text-xs">
                      Controls the school branding and title printed on the official report card.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold">School Name</Label>
                        <Input
                          value={schoolHeader.name}
                          onChange={(e) => setSchoolHeader({ ...schoolHeader, name: e.target.value })}
                          className="h-8 text-xs mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Affiliation Number / Text</Label>
                        <Input
                          value={schoolHeader.affiliation}
                          onChange={(e) => setSchoolHeader({ ...schoolHeader, affiliation: e.target.value })}
                          className="h-8 text-xs mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">Tagline / Motto</Label>
                        <Input
                          value={schoolHeader.tagline}
                          onChange={(e) => setSchoolHeader({ ...schoolHeader, tagline: e.target.value })}
                          className="h-8 text-xs mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold">School Address</Label>
                        <Input
                          value={schoolHeader.address}
                          onChange={(e) => setSchoolHeader({ ...schoolHeader, address: e.target.value })}
                          className="h-8 text-xs mt-1"
                        />
                      </div>
                    </div>

                    <div className="pt-3 border-t">
                      <Label className="text-xs font-semibold mb-2 block">Report Card Sections Order & Visibility</Label>
                      <div className="space-y-2">
                        {rcSections.map((sec, idx) => (
                          <div
                            key={sec.id}
                            className="p-2.5 rounded-lg border bg-muted/20 flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-muted-foreground w-4">{idx + 1}.</span>
                              <span className="font-medium">{sec.title}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">({sec.type})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={sec.enabled}
                                onCheckedChange={(val) => {
                                  const updated = [...rcSections];
                                  updated[idx].enabled = val;
                                  setRcSections(updated);
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TAB 6: CO-SCHOLASTIC AREAS */}
              {/* TAB 4: CO-SCHOLASTIC BUILDER */}
              <TabsContent value="coscholastic" className="space-y-4 mt-4">
                <Card className="rounded-2xl border shadow-sm">
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Sparkles size={18} className="text-primary" />
                        Co-Scholastic Section Builder
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Configure non-scholastic domains, discrete grading scales (e.g. 3-point A-C), and term evaluation columns.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => setCoScholasticConfig(DEFAULT_CO_SCHOLASTIC_CONFIG)}
                        className="text-xs h-8"
                      >
                        Reset to CBSE Default
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        onClick={handleOpenAddArea}
                        className="gap-1.5 text-xs h-8"
                      >
                        <Plus size={14} /> Add Activity
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-5">
                    {/* General Section Settings */}
                    <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Report Card Section Header & Scale
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs font-semibold">Section Title</Label>
                          <Input
                            value={coScholasticConfig.title}
                            onChange={(e) =>
                              setCoScholasticConfig((prev) => ({ ...prev, title: e.target.value }))
                            }
                            placeholder="PART 2: CO-SCHOLASTIC AREAS"
                            className="mt-1 h-8 text-xs font-bold"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Section Subtitle</Label>
                          <Input
                            value={coScholasticConfig.subtitle}
                            onChange={(e) =>
                              setCoScholasticConfig((prev) => ({ ...prev, subtitle: e.target.value }))
                            }
                            placeholder="(on a 3-Point (A-C) grading scale)"
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t">
                        <div>
                          <Label className="text-xs font-semibold">Grading Scale</Label>
                          <Select
                            value={coScholasticConfig.scaleId}
                            onValueChange={(val) =>
                              setCoScholasticConfig((prev) => ({ ...prev, scaleId: val }))
                            }
                          >
                            <SelectTrigger className="mt-1 h-8 text-xs bg-background">
                              <SelectValue placeholder="Select grading scale..." />
                            </SelectTrigger>
                            <SelectContent>
                              {discreteScales.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name} ({s.tiers.map((t) => t.grade).join("-")})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Tiers: {(discreteScales.find((s) => s.id === coScholasticConfig.scaleId)?.tiers || []).map((t) => `${t.grade}=${t.descriptor || t.description}`).join(", ")}
                          </p>
                        </div>

                        <div>
                          <Label className="text-xs font-semibold mb-1 block">Term Columns on Report Card</Label>
                          <div className="flex items-center gap-3 pt-1.5">
                            {["term_1", "term_2"].map((tId) => {
                              const label = tId === "term_1" ? "T1" : "T2";
                              const isChecked = (coScholasticConfig.termColumns || []).some((c) => c.termId === tId);
                              return (
                                <label key={tId} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                                  <Switch
                                    checked={isChecked}
                                    onCheckedChange={(checked) => {
                                      setCoScholasticConfig((prev) => {
                                        let cols = [...(prev.termColumns || [])];
                                        if (checked && !isChecked) {
                                          cols.push({ termId: tId, label });
                                          cols.sort((a, b) => (a.termId === "term_1" ? -1 : 1));
                                        } else if (!checked && isChecked) {
                                          cols = cols.filter((c) => c.termId !== tId);
                                        }
                                        return { ...prev, termColumns: cols };
                                      });
                                    }}
                                  />
                                  <span>{tId === "term_1" ? "Term 1 (T1)" : "Term 2 (T2)"}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Areas List */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Activities & Domains ({(coScholasticConfig.areas || []).length})
                        </Label>
                        <span className="text-[11px] text-muted-foreground">
                          Order here matches the physical report card table
                        </span>
                      </div>

                      {(coScholasticConfig.areas || []).map((area, idx) => (
                        <div
                          key={area.id}
                          className="p-3 rounded-xl border bg-card hover:bg-muted/10 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveArea(idx, -1)}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                type="button"
                                disabled={idx === coScholasticConfig.areas.length - 1}
                                onClick={() => handleMoveArea(idx, 1)}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-20 p-0.5"
                              >
                                <ArrowDown size={12} />
                              </button>
                            </div>
                            <span className="text-xs font-mono font-bold text-muted-foreground w-4 text-center">
                              {idx + 1}.
                            </span>
                            <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 bg-muted/40 font-bold">
                              {area.code || "ACT"}
                            </Badge>
                            <div>
                              <div className="text-xs font-semibold text-foreground">{area.name}</div>
                              <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                <Badge variant="secondary" className="text-[9px] py-0 px-1 font-normal">
                                  {area.category}
                                </Badge>
                                <span>•</span>
                                <span className={area.displayOnReportCard !== false ? "text-emerald-600" : "text-amber-600"}>
                                  {area.displayOnReportCard !== false ? "Visible on Report Card" : "Hidden"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-center">
                            <Switch
                              checked={area.displayOnReportCard !== false}
                              onCheckedChange={(val) => {
                                setCoScholasticConfig((prev) => ({
                                  ...prev,
                                  areas: prev.areas.map((a) => (a.id === area.id ? { ...a, displayOnReportCard: val } : a)),
                                }));
                              }}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={() => handleOpenEditArea(area)}
                              className="h-8 text-xs gap-1"
                            >
                              <Edit2 size={12} /> Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              type="button"
                              onClick={() => handleDeleteArea(area.id)}
                              className="text-red-500 hover:text-red-700 h-8 w-8"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      ))}

                      {coScholasticConfig.areas.length === 0 && (
                        <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                          No co-scholastic activities configured. Click "+ Add Activity" or "Reset to CBSE Default".
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Column: Split-Screen Live Physical Report Card Preview (5 cols on xl) */}
          <div className="xl:col-span-5 sticky top-6 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Printer size={16} className="text-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Report Card Preview
                </span>
                {selectedGrades.length > 0 && (
                  <div className="flex items-center gap-1.5 ml-1">
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">Grade:</span>
                    <Select value={activePreviewGrade} onValueChange={(g) => setPreviewGrade(g)}>
                      <SelectTrigger className="h-6 text-[11px] px-2 py-0 w-24 bg-white border">
                        <SelectValue placeholder="Grade" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedGrades.map((g) => (
                          <SelectItem key={g} value={g} className="text-xs">
                            Grade {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border">
                <Button
                  size="sm"
                  type="button"
                  variant={previewPeriod === "term_1" ? "default" : "ghost"}
                  className="h-6 text-[10px] px-2"
                  onClick={() => setPreviewPeriod("term_1")}
                >
                  Term 1
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant={previewPeriod === "term_2" ? "default" : "ghost"}
                  className="h-6 text-[10px] px-2"
                  onClick={() => setPreviewPeriod("term_2")}
                >
                  Term 2
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant={previewPeriod === "annual" ? "default" : "ghost"}
                  className="h-6 text-[10px] px-2"
                  onClick={() => setPreviewPeriod("annual")}
                >
                  Annual
                </Button>
              </div>
            </div>

            {/* A4 PHYSICAL REPORT CARD PREVIEW CONTAINER */}
            <div className="bg-white text-black p-5 rounded-2xl border shadow-xl font-serif text-[11px] leading-tight select-none overflow-x-auto">
              {/* Outer Double Border */}
              <div className="border-2 border-black p-3 space-y-3">
                {/* 1. School Header */}
                <div className="border-b border-black pb-2 text-center relative">
                  <div className="flex items-center justify-between mb-1">
                    <div className="w-12 h-12 flex items-center justify-center overflow-hidden">
                      <img src="/prestige_logo.png" alt="Prestige International School" className="h-full w-full object-contain" />
                    </div>
                    <div className="flex-1 px-2">
                      <h2 className="text-sm font-bold uppercase tracking-wide">{schoolHeader.name}</h2>
                      <p className="text-[9px] font-sans text-gray-700 italic">{schoolHeader.tagline}</p>
                      <p className="text-[8.5px] font-sans text-gray-600">{schoolHeader.affiliation}</p>
                    </div>
                    <div className="w-10 h-10 border border-gray-300 rounded flex items-center justify-center text-[9px] font-sans font-bold text-gray-700 bg-gray-50">
                      CBSE
                    </div>
                  </div>
                  <div className="bg-black text-white text-[10px] font-sans font-bold py-0.5 tracking-wider uppercase mt-1">
                    {previewPeriod === "term_1"
                      ? `Progress Report — Term 1 (${effectiveSessionName})`
                      : previewPeriod === "term_2"
                      ? `Progress Report — Term 2 (${effectiveSessionName})`
                      : `Consolidated Annual Report — Academic Year ${effectiveSessionName}`}
                  </div>
                </div>

                {/* 2. Student Biographical Profile */}
                <div className="border border-black p-1.5 font-sans text-[9px] grid grid-cols-2 gap-x-2 gap-y-0.5 bg-gray-50/50">
                  <div><span className="font-semibold">Student Name:</span> AARAV SHARMA</div>
                  <div><span className="font-semibold">Roll No:</span> 01</div>
                  <div><span className="font-semibold">Admission No:</span> PIS/2026/042</div>
                  <div><span className="font-semibold">Class & Section:</span> Grade {activePreviewGrade} - A</div>
                  <div><span className="font-semibold">Father's Name:</span> RAJESH SHARMA</div>
                  <div><span className="font-semibold">DOB:</span> 14/08/2015</div>
                </div>

                {/* 3. Scholastic Assessment Table */}
                <div>
                  <div className="bg-black text-white text-[9.5px] font-sans font-bold px-1.5 py-0.5 uppercase tracking-wide">
                    Part 1: Scholastic Areas
                  </div>
                  {(() => {
                    const termsList = scholasticTableConfig?.terms || [];
                    const t1Cfg = termsList.find((t) => t.termId === "term_1") || termsList[0] || DEFAULT_SCHOLASTIC_TABLE_CONFIG.terms[0];
                    const t2Cfg = termsList.find((t) => t.termId === "term_2") || termsList[1] || DEFAULT_SCHOLASTIC_TABLE_CONFIG.terms[1];
                    const t1Comps = (t1Cfg?.assessmentComponents || []).filter((c) => c.displayOnReportCard !== false);
                    const t2Comps = (t2Cfg?.assessmentComponents || []).filter((c) => c.displayOnReportCard !== false);
                    const t1Max = deriveTermMaxMarks(t1Cfg);
                    const t2Max = deriveTermMaxMarks(t2Cfg);
                    const overallCfg = scholasticTableConfig?.overallConfig || scholasticTableConfig?.overall || DEFAULT_SCHOLASTIC_TABLE_CONFIG.overallConfig;

                    let ovColCount = 0;
                    if (overallCfg?.showOverallTotal) ovColCount++;
                    if (overallCfg?.showGrade) ovColCount++;
                    if (overallCfg?.showRank) ovColCount++;

                    const previewSubjects = previewSubjectsNames;
                    const isSampleSubjects = previewScholasticSubjects.length === 0;

                    if (previewPeriod === "term_1") {
                      return (
                        <div>
                          <table className="w-full border-collapse border border-black text-[8px] font-sans mt-0.5 text-center">
                            <thead>
                              <tr className="bg-gray-100 font-bold border-b border-black">
                                <th className="border border-black p-1 text-left">Subjects</th>
                                {t1Comps.map((c) => (
                                  <th key={c.id} className="border border-black p-1">
                                    {c.code}
                                    <span className="block text-[7px] font-normal text-gray-600">
                                      ({c.scalingTargetMarks ?? c.maxMarks})
                                    </span>
                                  </th>
                                ))}
                                <th className="border border-black p-1">Total ({t1Max})</th>
                                <th className="border border-black p-1">Grade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewSubjects.map((sub, idx) => {
                                const t1Total = t1Comps.reduce(
                                  (acc, c) => acc + Math.round((c.scalingTargetMarks ?? c.maxMarks) * (0.82 + ((idx * 3) % 15) * 0.01)),
                                  0
                                );
                                return (
                                  <tr key={sub} className="border-b border-gray-300">
                                    <td className="border border-black p-1 text-left font-medium">{sub}</td>
                                    {t1Comps.map((c) => (
                                      <td key={c.id} className="border border-black p-1">
                                        {Math.round((c.scalingTargetMarks ?? c.maxMarks) * (0.82 + ((idx * 3) % 15) * 0.01))}
                                      </td>
                                    ))}
                                    <td className="border border-black p-1 font-bold">{t1Total}</td>
                                    <td className="border border-black p-1 font-bold">A1</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {isSampleSubjects && (
                            <div className="text-[7.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 flex items-center justify-between font-sans">
                              <span>* Showing sample preview subjects (No scholastic subjects found for Grade {activePreviewGrade} in Admin Subjects)</span>
                              <Link href="/admin/subjects" className="text-primary underline font-medium inline-flex items-center gap-0.5">
                                Add in Admin <ExternalLink size={8} />
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    }

                    if (previewPeriod === "term_2") {
                      return (
                        <div>
                          <table className="w-full border-collapse border border-black text-[8px] font-sans mt-0.5 text-center">
                            <thead>
                              <tr className="bg-gray-100 font-bold border-b border-black">
                                <th className="border border-black p-1 text-left">Subjects</th>
                                {t2Comps.map((c) => (
                                  <th key={c.id} className="border border-black p-1">
                                    {c.code}
                                    <span className="block text-[7px] font-normal text-gray-600">
                                      ({c.scalingTargetMarks ?? c.maxMarks})
                                    </span>
                                  </th>
                                ))}
                                <th className="border border-black p-1">Total ({t2Max})</th>
                                <th className="border border-black p-1">Grade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewSubjects.map((sub, idx) => {
                                const t2Total = t2Comps.reduce(
                                  (acc, c) => acc + Math.round((c.scalingTargetMarks ?? c.maxMarks) * (0.85 + ((idx * 2) % 14) * 0.01)),
                                  0
                                );
                                return (
                                  <tr key={sub} className="border-b border-gray-300">
                                    <td className="border border-black p-1 text-left font-medium">{sub}</td>
                                    {t2Comps.map((c) => (
                                      <td key={c.id} className="border border-black p-1">
                                        {Math.round((c.scalingTargetMarks ?? c.maxMarks) * (0.85 + ((idx * 2) % 14) * 0.01))}
                                      </td>
                                    ))}
                                    <td className="border border-black p-1 font-bold">{t2Total}</td>
                                    <td className="border border-black p-1 font-bold">A1</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {isSampleSubjects && (
                            <div className="text-[7.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 flex items-center justify-between font-sans">
                              <span>* Showing sample preview subjects (No scholastic subjects found for Grade {activePreviewGrade} in Admin Subjects)</span>
                              <Link href="/admin/subjects" className="text-primary underline font-medium inline-flex items-center gap-0.5">
                                Add in Admin <ExternalLink size={8} />
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    }

                    // Annual / Full Consolidated Table matching media_1790212833617.png
                    return (
                      <div>
                        <table className="w-full border-collapse border border-black text-[7.5px] font-sans mt-0.5 text-center">
                          <thead>
                            {/* ROW 1: Grouped Headers */}
                            <tr className="bg-gray-100 font-bold border-b border-black text-[8px]">
                              <th rowSpan={2} className="border border-black p-1 text-left min-w-[65px]">
                                Subjects
                              </th>
                              <th colSpan={t1Comps.length + 1} className="border border-black p-0.5 uppercase bg-gray-50">
                                {t1Cfg?.termName || "TERM 1"}
                                <span className="block text-[7px] font-normal text-gray-700">{t1Max} Marks</span>
                              </th>
                              <th colSpan={t2Comps.length + 1} className="border border-black p-0.5 uppercase bg-gray-50">
                                {t2Cfg?.termName || "TERM 2"}
                                <span className="block text-[7px] font-normal text-gray-700">{t2Max} Marks</span>
                              </th>
                              {ovColCount > 0 && (
                                <th colSpan={ovColCount} className="border border-black p-0.5 uppercase bg-gray-50">
                                  {overallCfg?.title || "OVERALL"}
                                  <span className="block text-[7px] font-normal text-gray-700">
                                    {overallCfg?.subtitle || "Term 1 + Term 2"}
                                  </span>
                                </th>
                              )}
                            </tr>

                            {/* ROW 2: Column Subheaders */}
                            <tr className="bg-gray-100 font-bold border-b border-black text-[7px]">
                              {t1Comps.map((c) => (
                                <th key={c.id} className="border border-black p-0.5">
                                  {c.code}
                                </th>
                              ))}
                              <th className="border border-black p-0.5 font-bold">Total</th>

                              {t2Comps.map((c) => (
                                <th key={c.id} className="border border-black p-0.5">
                                  {c.code}
                                </th>
                              ))}
                              <th className="border border-black p-0.5 font-bold">Total</th>

                              {overallCfg?.showOverallTotal && (
                                <th className="border border-black p-0.5 font-bold">Total</th>
                              )}
                              {overallCfg?.showGrade && (
                                <th className="border border-black p-0.5 font-bold">Grade</th>
                              )}
                              {overallCfg?.showRank && (
                                <th className="border border-black p-0.5 font-bold text-primary">Rank</th>
                              )}
                            </tr>

                            {/* ROW 3: Dedicated Max Marks Subheader Row */}
                            <tr className="bg-gray-50/90 font-bold border-b border-black text-[7px] text-gray-700">
                              <td className="border border-black p-0.5 text-left text-gray-400 font-normal"></td>
                              {t1Comps.map((c) => (
                                <td key={c.id} className="border border-black p-0.5">
                                  {c.scalingTargetMarks ?? c.maxMarks}
                                </td>
                              ))}
                              <td className="border border-black p-0.5 font-bold">{t1Max}</td>

                              {t2Comps.map((c) => (
                                <td key={c.id} className="border border-black p-0.5">
                                  {c.scalingTargetMarks ?? c.maxMarks}
                                </td>
                              ))}
                              <td className="border border-black p-0.5 font-bold">{t2Max}</td>

                              {overallCfg?.showOverallTotal && (
                                <td className="border border-black p-0.5 font-bold">
                                  {Math.round(
                                    (t1Max * (overallCfg?.term1Weight || 50) + t2Max * (overallCfg?.term2Weight || 50)) / 100
                                  )}
                                </td>
                              )}
                              {overallCfg?.showGrade && <td className="border border-black p-0.5">-</td>}
                              {overallCfg?.showRank && <td className="border border-black p-0.5">-</td>}
                            </tr>
                          </thead>

                          <tbody>
                            {previewSubjects.map((sub, sIdx) => {
                              const t1Total = t1Comps.reduce(
                                (acc, c) => acc + Math.round((c.scalingTargetMarks ?? c.maxMarks) * (0.82 + ((sIdx * 3) % 15) * 0.01)),
                                0
                              );
                              const t2Total = t2Comps.reduce(
                                (acc, c) => acc + Math.round((c.scalingTargetMarks ?? c.maxMarks) * (0.85 + ((sIdx * 2) % 13) * 0.01)),
                                0
                              );
                              const ovTotal = Math.round(
                                (t1Total * (overallCfg?.term1Weight || 50) + t2Total * (overallCfg?.term2Weight || 50)) / 100
                              );
                              const grade = ovTotal >= 90 ? "A1" : ovTotal >= 80 ? "A2" : ovTotal >= 70 ? "B1" : "B2";
                              const rank = sIdx + 1;

                              return (
                                <tr key={sub} className="border-b border-gray-300">
                                  <td className="border border-black p-1 text-left font-medium">{sub}</td>

                                  {t1Comps.map((c) => (
                                    <td key={c.id} className="border border-black p-0.5">
                                      {Math.round((c.scalingTargetMarks ?? c.maxMarks) * (0.82 + ((sIdx * 3) % 15) * 0.01))}
                                    </td>
                                  ))}
                                  <td className="border border-black p-0.5 font-semibold bg-gray-50/40">{t1Total}</td>

                                  {t2Comps.map((c) => (
                                    <td key={c.id} className="border border-black p-0.5">
                                      {Math.round((c.scalingTargetMarks ?? c.maxMarks) * (0.85 + ((sIdx * 2) % 13) * 0.01))}
                                    </td>
                                  ))}
                                  <td className="border border-black p-0.5 font-semibold bg-gray-50/40">{t2Total}</td>

                                  {overallCfg?.showOverallTotal && (
                                    <td className="border border-black p-0.5 font-bold bg-gray-50/60">{ovTotal}</td>
                                  )}
                                  {overallCfg?.showGrade && (
                                    <td className="border border-black p-0.5 font-bold">{grade}</td>
                                  )}
                                  {overallCfg?.showRank && (
                                    <td className="border border-black p-0.5 font-bold text-primary">{rank}</td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {isSampleSubjects && (
                          <div className="text-[7.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 flex items-center justify-between font-sans">
                            <span>* Showing sample preview subjects (No scholastic subjects found for Grade {activePreviewGrade} in Admin Subjects)</span>
                            <Link href="/admin/subjects" className="text-primary underline font-medium inline-flex items-center gap-0.5">
                              Add in Admin <ExternalLink size={8} />
                            </Link>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* 4. Co-Scholastic Activities matching media_1790212844305.png */}
                <div>
                  <div className="bg-black text-white text-[9px] font-sans font-bold px-1.5 py-0.5 uppercase tracking-wide">
                    {coScholasticConfig?.title || "PART 2: CO-SCHOLASTIC AREAS"}
                  </div>
                  {coScholasticConfig?.subtitle && (
                    <div className="text-[7.5px] font-sans text-gray-700 italic px-1 py-0.5 bg-gray-50 border-x border-b border-black">
                      {coScholasticConfig.subtitle}
                    </div>
                  )}
                  <table className="w-full border-collapse border border-black text-[8px] font-sans mt-0.5 text-center">
                    <thead>
                      <tr className="bg-gray-100 font-bold border-b border-black text-[7.5px]">
                        <th className="border border-black p-1 text-left">Activity</th>
                        {(coScholasticConfig?.termColumns || []).map((col) => (
                          <th key={col.termId} className="border border-black p-1 w-12">
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(coScholasticConfig?.areas || [])
                        .filter((a) => a.displayOnReportCard !== false)
                        .map((area, idx) => (
                          <tr key={area.id} className="border-b border-gray-300">
                            <td className="border border-black p-1 text-left font-medium">
                              {idx + 1}. {area.name}
                            </td>
                            {(coScholasticConfig?.termColumns || []).map((col) => (
                              <td key={col.termId} className="border border-black p-1 font-bold">
                                {idx % 3 === 0 ? "A" : idx % 3 === 1 ? "B" : "A"}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <div className="text-[7px] text-gray-600 mt-1 font-sans text-center">
                    [Grading Scale: {
                      (discreteScales.find((s) => s.id === coScholasticConfig?.scaleId) || discreteScales[0])?.tiers
                        ?.map((t) => `${t.grade} = ${t.descriptor || t.description}`)
                        .join(", ")
                    }]
                  </div>
                </div>

                {/* 5. Attendance & Remarks (Phase 3 slot) */}
                <div className="border border-black p-1.5 font-sans text-[8.5px] space-y-1">
                  <div className="flex justify-between">
                    <span><span className="font-semibold">Attendance:</span> [Attendance Slot — Phase 3 Engine]</span>
                    <span><span className="font-semibold">Result:</span> <span className="font-bold text-emerald-700">PASSED</span></span>
                  </div>
                  <div>
                    <span className="font-semibold">Class Teacher Remarks:</span> Exemplary discipline and consistent academic performance throughout the year.
                  </div>
                  <div>
                    <span className="font-semibold">Promoted To:</span> Grade {Number(activePreviewGrade || 5) + 1}
                  </div>
                </div>

                {/* 6. Official Institutional Signatures */}
                <div className="pt-4 flex justify-between items-end text-center font-sans text-[8px] text-gray-800">
                  <div className="space-y-1">
                    <div className="w-20 border-b border-black mx-auto"></div>
                    <p className="font-semibold">Class Teacher</p>
                  </div>
                  <div className="space-y-1">
                    <div className="w-20 border-b border-black mx-auto"></div>
                    <p className="font-semibold">Section Head / HOD</p>
                  </div>
                  <div className="space-y-1">
                    <div className="w-20 border-b border-black mx-auto"></div>
                    <p className="font-semibold">Principal</p>
                  </div>
                </div>

                {/* 7. Bottom Grading Scale Reference */}
                <div className="border-t border-gray-300 pt-1 text-center font-sans text-[7.5px] text-gray-600">
                  Grading Scale: {gradingScale.tiers.map((t) => `${t.minPercentage}-${t.maxPercentage}%: ${t.grade}`).join(" | ")}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Card className="rounded-2xl p-12 text-center text-muted-foreground border">
          <Layers size={40} className="mx-auto text-primary/40 mb-3" />
          <h3 className="text-lg font-bold text-foreground">No Academic Structure Selected</h3>
          <p className="text-sm mt-1 max-w-md mx-auto">
            Create an Academic Structure to configure your school's examination hierarchy, grading scale, and report card layouts.
          </p>
          <Button onClick={() => setNewStructureModal(true)} className="mt-4 gap-1.5">
            <Plus size={16} /> Create Academic Structure
          </Button>
        </Card>
      )}

      {/* DIALOG: CREATE NEW STRUCTURE */}
      <Dialog open={newStructureModal} onOpenChange={setNewStructureModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Academic Structure</DialogTitle>
            <DialogDescription>
              Initialize a reusable academic structure configuration for an academic group (e.g. Primary, Middle, High).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold">Structure Name</Label>
              <Input
                value={newStructName}
                onChange={(e) => setNewStructName(e.target.value)}
                placeholder="e.g. Primary Wing (Grades 1 to 5)"
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Description</Label>
              <Input
                value={newStructDesc}
                onChange={(e) => setNewStructDesc(e.target.value)}
                placeholder="CBSE aligned primary school continuous assessment structure."
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold mb-1 block">Applicable Grades</Label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_GRADES.map((g) => {
                  const sel = newStructGrades.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        if (sel) setNewStructGrades(newStructGrades.filter((item) => item !== g));
                        else setNewStructGrades([...newStructGrades, g].sort((a, b) => Number(a) - Number(b)));
                      }}
                      className={`px-2.5 py-1 rounded text-xs border ${
                        sel ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      Gr {g}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewStructureModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateNewStructure} disabled={saving || !newStructName.trim()}>
              Create Structure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: VERSION BUMP */}
      <Dialog open={versionBumpModal} onOpenChange={setVersionBumpModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Version (v{(activeStructure?.currentVersion || 1) + 1})</DialogTitle>
            <DialogDescription>
              Freezes the historical version and creates a new immutable version for current and future examination cycles.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <Label className="text-xs font-semibold">Version Notes / Change Summary</Label>
            <Input
              value={versionBumpNotes}
              onChange={(e) => setVersionBumpNotes(e.target.value)}
              placeholder="e.g. Updated term examination weightage to 80%."
            />
            <p className="text-xs text-muted-foreground">
              Historical published report cards will permanently reference version v{activeStructure?.currentVersion || 1} and will never change.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionBumpModal(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleSaveStructure(true, versionBumpNotes)} disabled={saving}>
              Confirm New Version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: DUPLICATE */}
      <Dialog open={duplicateModal} onOpenChange={setDuplicateModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate Academic Structure</DialogTitle>
            <DialogDescription>
              Clones the entire structure configuration, exams, components, and grading scales into a fresh draft.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs font-semibold">New Structure Name</Label>
            <Input
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleDuplicate} disabled={saving || !duplicateName.trim()}>
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: ADD / EDIT ASSESSMENT COMPONENT */}
      <Dialog open={compDialogOpen} onOpenChange={setCompDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingCompId ? "Edit Assessment Component" : "Add Assessment Component"}
            </DialogTitle>
            <DialogDescription>
              Configure the code, testing marks, scaled marks, and calculation method for {compFormTermId === "term_1" ? "Term 1" : "Term 2"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-xs font-semibold">Component Name</Label>
                <Input
                  value={compFormData.name}
                  onChange={(e) => setCompFormData({ ...compFormData, name: e.target.value })}
                  placeholder="e.g. Periodic Test, Theory, Practical"
                  className="mt-1 h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">Header Code</Label>
                <Input
                  value={compFormData.code}
                  onChange={(e) => setCompFormData({ ...compFormData, code: e.target.value.toUpperCase() })}
                  placeholder="PT"
                  className="mt-1 h-8 text-xs font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-semibold">Tested Max Marks</Label>
                <Input
                  type="number"
                  value={compFormData.testedMaxMarks}
                  onChange={(e) =>
                    setCompFormData({
                      ...compFormData,
                      testedMaxMarks: Number(e.target.value) || 0,
                      maxMarks: Number(e.target.value) || 0,
                    })
                  }
                  className="mt-1 h-8 text-xs"
                />
                <span className="text-[10px] text-muted-foreground">Max marks entered by teacher</span>
              </div>
              <div>
                <Label className="text-xs font-semibold">Scaling Target Marks</Label>
                <Input
                  type="number"
                  value={compFormData.scalingTargetMarks}
                  onChange={(e) =>
                    setCompFormData({ ...compFormData, scalingTargetMarks: Number(e.target.value) || 0 })
                  }
                  className="mt-1 h-8 text-xs font-bold"
                />
                <span className="text-[10px] text-muted-foreground">Weight on report card</span>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Calculation Method</Label>
              <Select
                value={compFormData.calculationMethod}
                onValueChange={(val: CalculationMethod) =>
                  setCompFormData({ ...compFormData, calculationMethod: val })
                }
              >
                <SelectTrigger className="mt-1 h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw">Raw (Direct Score as Tested)</SelectItem>
                  <SelectItem value="scale_to_target">Scale to Target (e.g. 40 down to 10)</SelectItem>
                  <SelectItem value="best_of">Best of Multiple Tests</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-medium">Contribute to Term Total</Label>
                  <p className="text-[10px] text-muted-foreground">Included when calculating term grand total</p>
                </div>
                <Switch
                  checked={compFormData.contributeToTotal}
                  onCheckedChange={(val) => setCompFormData({ ...compFormData, contributeToTotal: val })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-medium">Display on Physical Report Card</Label>
                  <p className="text-[10px] text-muted-foreground">Renders dedicated column in scholastic table</p>
                </div>
                <Switch
                  checked={compFormData.displayOnReportCard}
                  onCheckedChange={(val) => setCompFormData({ ...compFormData, displayOnReportCard: val })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCompDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveComponentModal}>
              {editingCompId ? "Update Component" : "Add Component"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: ADD / EDIT CO-SCHOLASTIC AREA */}
      <Dialog open={areaDialogOpen} onOpenChange={setAreaDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingAreaId ? "Edit Co-Scholastic Activity" : "Add Co-Scholastic Activity"}
            </DialogTitle>
            <DialogDescription>
              Define the activity domain name, short code, and category.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs font-semibold">Activity / Domain Name</Label>
              <Input
                value={areaFormData.name}
                onChange={(e) => setAreaFormData({ ...areaFormData, name: e.target.value })}
                placeholder="e.g. Work Education (or Pre-vocational Education)"
                className="mt-1 h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-semibold">Code / Abbreviation</Label>
                <Input
                  value={areaFormData.code}
                  onChange={(e) => setAreaFormData({ ...areaFormData, code: e.target.value.toUpperCase() })}
                  placeholder="WE"
                  className="mt-1 h-8 text-xs font-mono font-bold"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">Category</Label>
                <Select
                  value={areaFormData.category}
                  onValueChange={(val: any) => setAreaFormData({ ...areaFormData, category: val })}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="co-scholastic">Co-Scholastic</SelectItem>
                    <SelectItem value="discipline">Discipline</SelectItem>
                    <SelectItem value="life-skills">Life Skills</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAreaDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAreaModal}>
              {editingAreaId ? "Update Activity" : "Add Activity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
