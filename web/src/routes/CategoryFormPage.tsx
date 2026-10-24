/**
 * Add or edit a category (Catalogue → Admin categories; back-office.md →
 * Forms). `POST` / `PATCH` (only the changed fields), then the image upload
 * or removal. 422 messages sit under their fields; anything else shows in the
 * banner. When the record saves but the image step fails, the page stays on
 * the saved category with the message, so the image can be tried again.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { ImageField } from '@/components/common/ImageField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { ImageStepError, useAdminCategory, useSaveCategory, type ImageChange } from '@/hooks/useCatalogAdmin';
import type { Category, CategoryCreateRequest, CategoryUpdateRequest } from '@/services/types';
import { nullIfBlank, parseSortOrder, SORT_ORDER_MESSAGE, splitSaveError, tooLong, type FieldErrors } from '@/utils/forms';

const LIMITS = { name: 80, description: 255 } as const;
const FIELDS = ['name', 'description', 'sort_order', 'is_active', 'image'] as const;

type Draft = { name: string; description: string; sortOrder: string; isActive: boolean };

function draftFrom(category: Category | null): Draft {
  return {
    name: category?.name ?? '',
    description: category?.description ?? '',
    sortOrder: String(category?.sort_order ?? 0),
    isActive: category?.is_active ?? true,
  };
}

function check(draft: Draft): { body: CategoryCreateRequest | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = draft.name.trim();
  const description = nullIfBlank(draft.description);
  const sortOrder = parseSortOrder(draft.sortOrder);
  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > LIMITS.name) errors.name = tooLong(LIMITS.name);
  if (description !== null && description.length > LIMITS.description) errors.description = tooLong(LIMITS.description);
  if (sortOrder === null) errors.sort_order = SORT_ORDER_MESSAGE;
  if (Object.keys(errors).length > 0 || sortOrder === null) return { body: null, errors };
  return { body: { name, description, sort_order: sortOrder, is_active: draft.isActive }, errors };
}

function diff(saved: Category, body: CategoryCreateRequest): CategoryUpdateRequest {
  const changes: CategoryUpdateRequest = {};
  if (body.name !== saved.name) changes.name = body.name;
  if ((body.description ?? null) !== saved.description) changes.description = body.description ?? null;
  if (body.sort_order !== saved.sort_order) changes.sort_order = body.sort_order;
  if (body.is_active !== saved.is_active) changes.is_active = body.is_active;
  return changes;
}

export function CategoryFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const editing = id !== null && Number.isSafeInteger(id);
  const existing = useAdminCategory(editing ? id : null);
  useShellHeader(editing ? 'Edit category' : 'Add category');

  if (editing && existing.loading) return <LoadingRows rows={6} label="Loading the category…" />;
  if (editing && (existing.error || !existing.category)) {
    return (
      <PlainPage title="Edit category">
        <Card>
          <ErrorState message={existing.error ?? 'Not found.'} onRetry={existing.reload} />
        </Card>
      </PlainPage>
    );
  }
  return <CategoryForm key={existing.category?.id ?? 'new'} category={editing ? existing.category : null} />;
}

function CategoryForm({ category }: { category: Category | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(category));
  const [image, setImage] = useState<ImageChange>({ kind: 'none' });
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [imageError, setImageError] = useState<string | null>(() => {
    const state = location.state as { imageError?: string } | null;
    return state?.imageError ?? null;
  });
  const save = useSaveCategory(category?.id ?? null);

  const failure = save.error instanceof ImageStepError ? null : save.error;
  const server = splitSaveError(failure, FIELDS);
  const fieldError = (field: (typeof FIELDS)[number]) => clientErrors[field] ?? server.fieldErrors[field] ?? null;

  function change(update: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...update }));
    setClientErrors({});
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const checked = check(draft);
    setClientErrors(checked.errors);
    if (!checked.body) return;
    setImageError(null);
    const body = category ? diff(category, checked.body) : checked.body;
    save.mutate(
      { body, image },
      {
        onSuccess: (saved) => {
          toast.success(category ? `${saved.name} saved.` : `${saved.name} added.`);
          void navigate('/categories');
        },
        onError: (error) => {
          if (!(error instanceof ImageStepError)) return;
          if (category) {
            setImage({ kind: 'none' });
            setImageError(error.message);
          } else {
            void navigate(`/categories/${error.savedId}`, { replace: true, state: { imageError: error.message } });
          }
        },
      },
    );
  }

  return (
    <PlainPage title={category ? `Edit ${category.name}` : 'Add category'} subtitle="A section of the menu on the POS.">
      <form className="w-full max-w-[720px]" onSubmit={onSubmit} noValidate aria-busy={save.isPending}>
        <ErrorSummary />
        <Card className="flex flex-col gap-5 p-5">
          {server.banner ? <Banner>{server.banner}</Banner> : null}
          {imageError ? <Banner variant="warning">{imageError}</Banner> : null}

          <FormField label="Name" error={fieldError('name')}>
            <Input value={draft.name} maxLength={LIMITS.name} onChange={(event) => change({ name: event.target.value })} placeholder="e.g. Breakfast" />
          </FormField>

          <FormField label="Description (optional)" error={fieldError('description')}>
            <Textarea
              value={draft.description}
              maxLength={LIMITS.description}
              onChange={(event) => change({ description: event.target.value })}
              placeholder="e.g. Served until 11 AM"
            />
          </FormField>

          <FormField label="Sort order" error={fieldError('sort_order')} hint="Lower numbers show first on the POS." className="max-w-[200px]">
            <Input inputMode="numeric" value={draft.sortOrder} onChange={(event) => change({ sortOrder: event.target.value })} className="tabular" />
          </FormField>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="category-active">Active</Label>
              <p className="text-[13px] text-muted-foreground">Inactive categories and their products are hidden from the POS.</p>
            </div>
            <Switch id="category-active" checked={draft.isActive} onCheckedChange={(isActive) => change({ isActive })} />
          </div>

          <ImageField
            label="Image (optional)"
            imageUrl={category?.image_url ?? null}
            imagePath={category?.image_path ?? null}
            value={image}
            onChange={(next) => {
              setImage(next);
              setImageError(null);
            }}
            baseName={category ? `category-${category.id}` : 'category'}
            error={fieldError('image')}
            disabled={save.isPending}
          />
        </Card>

        <div className="sticky bottom-0 mt-4 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
          <Button asChild variant="outline" size="lg">
            <Link to="/categories">Cancel</Link>
          </Button>
          <Button type="submit" variant="green" size="lg" disabled={save.isPending}>
            {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </PlainPage>
  );
}
