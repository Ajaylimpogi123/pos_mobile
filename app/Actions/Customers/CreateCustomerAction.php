<?php

namespace App\Actions\Customers;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Customer;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Creates a customer and writes a `customer.created` audit entry.
 */
class CreateCustomerAction
{
    public const AUDITED_FIELDS = ['first_name', 'last_name', 'contact', 'email', 'notes'];

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input
     */
    public function execute(array $attributes, User $actor, ?string $ip = null): Customer
    {
        return DB::transaction(function () use ($attributes, $actor, $ip): Customer {
            $customer = new Customer;
            $customer->fill($attributes);
            $customer->forceFill(['created_by' => $actor->id, 'updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'customer.created',
                actor: $actor,
                subject: $customer,
                changes: ModelChanges::created($customer, self::AUDITED_FIELDS),
                ip: $ip,
            );

            return $customer;
        });
    }
}
