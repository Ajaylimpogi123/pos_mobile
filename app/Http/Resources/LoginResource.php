<?php

namespace App\Http\Resources;

use App\Actions\Auth\LoginResult;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Response body of POST /api/v1/auth/login.
 *
 * @property-read LoginResult $resource
 */
class LoginResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var LoginResult $result */
        $result = $this->resource;

        return [
            'token' => $result->token->plainTextToken,
            'token_type' => 'Bearer',
            'expires_at' => $result->token->accessToken->expires_at->toIso8601ZuluString(),
            'user' => new AuthUserResource($result->user),
        ];
    }
}
