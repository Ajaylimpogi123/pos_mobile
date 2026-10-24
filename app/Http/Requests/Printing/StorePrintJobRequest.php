<?php

namespace App\Http\Requests\Printing;

use App\Exceptions\ConflictException;
use App\Models\Device;
use App\Models\Printer;
use App\Models\PrintJob;
use App\Models\User;
use App\Support\Ulid;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/print-jobs (any authenticated user; Web POS & Print Bridge → D), checked in
 * this order:
 *
 * 1. `409 "Register this terminal first."` when the token isn't bound to a device of the
 *    caller's branch;
 * 2. the field rules (`422`). A repeat (the ULID of a job of the caller's branch) skips the
 *    printer checks, so it still gets its stored job when the printer was disabled since.
 *    A ULID already used in another branch is `422` on `ulid`.
 */
class StorePrintJobRequest extends FormRequest
{
    public const MESSAGE_NO_DEVICE = 'Register this terminal first.';

    public const MESSAGE_PRINTER_INVALID = 'The selected printer is invalid.';

    public const MESSAGE_PRINTER_DISABLED = 'This printer is disabled.';

    public const MESSAGE_TOO_LARGE = 'The print data is too large.';

    public const MESSAGE_NOT_BASE64 = 'The print data must be valid base64.';

    /**
     * The longest base64 text of a 65,536-byte payload: 4 characters per 3 bytes, rounded up
     * (4 × ceil(65536 / 3)).
     */
    private const MAX_ENCODED_LENGTH = 87384;

    private ?Device $device = null;

    /**
     * @throws ConflictException 409 without a device
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('create', PrintJob::class)) {
            return false;
        }

        $this->device = Device::ofSession($user) ?? throw new ConflictException(self::MESSAGE_NO_DEVICE);

        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $branchId = $this->branchId();

        return [
            'ulid' => [
                'bail', 'required', 'string', 'regex:'.Ulid::PATTERN,
                Rule::unique('print_jobs', 'ulid')->where(fn ($query) => $query->where('branch_id', '<>', $branchId)),
            ],
            'printer_id' => ['bail', 'required', 'integer', ...($this->isRepeat() ? [] : [
                Rule::exists('printers', 'id')->where('branch_id', $branchId)->whereNull('deleted_at'),
                $this->enabledPrinter(),
            ])],
            'kind' => ['required', 'string', Rule::in(PrintJob::KINDS)],
            'order_ulid' => [
                'required_unless:kind,'.implode(',', PrintJob::KINDS_WITHOUT_ORDER),
                'nullable', 'string', 'regex:'.Ulid::PATTERN,
            ],
            // Q-047: a receipt may be copy 1–10 (one per equal-split share); other kinds 1–3.
            'copy_no' => ['sometimes', 'integer', 'min:1', 'max:'.($this->input('kind') === PrintJob::KIND_RECEIPT ? 10 : 3)],
            'is_reprint' => ['sometimes', 'boolean'],
            'payload_base64' => ['bail', 'required', 'string', $this->payloadRule()],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'printer_id.exists' => self::MESSAGE_PRINTER_INVALID,
        ];
    }

    /**
     * The device the caller's token is bound to.
     */
    public function device(): Device
    {
        return $this->device ?? throw new ConflictException(self::MESSAGE_NO_DEVICE);
    }

    /**
     * The decoded ESC/POS bytes (valid after validation).
     */
    public function payload(): string
    {
        return (string) base64_decode((string) $this->validated('payload_base64'), true);
    }

    private function branchId(): int
    {
        /** @var User $user */
        $user = $this->user();

        return (int) $user->branch_id;
    }

    private function isRepeat(): bool
    {
        $ulid = $this->input('ulid');

        return Ulid::isValid($ulid)
            && PrintJob::query()->where('branch_id', $this->branchId())->where('ulid', $ulid)->exists();
    }

    private function enabledPrinter(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            $enabled = Printer::query()
                ->where('branch_id', $this->branchId())
                ->whereKey($value)
                ->value('is_enabled');

            if (! (bool) $enabled) {
                $fail(self::MESSAGE_PRINTER_DISABLED);
            }
        };
    }

    /**
     * Valid base64 that decodes to 1–MAX_PAYLOAD_BYTES bytes.
     */
    private function payloadRule(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            if (strlen((string) $value) > self::MAX_ENCODED_LENGTH) {
                $fail(self::MESSAGE_TOO_LARGE);

                return;
            }

            $decoded = base64_decode((string) $value, true);

            if ($decoded === false || $decoded === '') {
                $fail(self::MESSAGE_NOT_BASE64);

                return;
            }

            if (strlen($decoded) > PrintJob::MAX_PAYLOAD_BYTES) {
                $fail(self::MESSAGE_TOO_LARGE);
            }
        };
    }
}
